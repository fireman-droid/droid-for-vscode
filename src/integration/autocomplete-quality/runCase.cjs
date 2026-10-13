const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Runs reviewed generated code with a fake clock in a separate, permission-limited process.
// This is not a security sandbox for malicious programs. The parent enforces a time limit.
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = path.dirname(process.argv[2]);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const originalNow = Date.now;
const originalTimeout = global.setTimeout;
const originalInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

async function run() {
  for (const test of input.tests) {
    let now = 1000, scheduled = 0, assertions = 0, nextTimer = 0;
    const timers = new Map();
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    const schedule = (callback, delay, repeat, args) => {
      scheduled += 1;
      const id = ++nextTimer;
      timers.set(id, { callback, due: now + Math.max(0, Number(delay) || 0), repeat, args });
      return id;
    };
    const clock = {
      now: () => now,
      set: (value) => { now = value; },
      timerCalls: () => scheduled,
      flush,
      async advance(milliseconds) {
        now += milliseconds;
        let count = 0;
        while (true) {
          const due = [...timers].find(([, timer]) => timer.due <= now);
          if (!due) break;
          if (++count > 1000) throw new Error('Timer loop exceeded evaluation limit');
          const [id, timer] = due;
          timers.delete(id);
          timer.callback(...timer.args);
          if (timer.repeat !== null) timers.set(id, { ...timer, due: now + Math.max(1, timer.repeat) });
          await flush();
        }
        await flush();
      },
    };
    const countedAssert = new Proxy(assert, {
      apply(target, receiver, args) { assertions++; return Reflect.apply(target, receiver, args); },
      get(target, key) {
        const member = target[key];
        return typeof member !== 'function' ? member : (...args) => { assertions++; return member(...args); };
      },
    });
    let passed = false, error;
    try {
      Date.now = () => now;
      global.setTimeout = (callback, delay, ...args) => schedule(callback, delay, null, args);
      global.setInterval = (callback, delay, ...args) => schedule(callback, delay, Number(delay) || 0, args);
      global.clearTimeout = global.clearInterval = id => timers.delete(id);
      for (const file of Object.keys(require.cache)) if (file.startsWith(root + path.sep)) delete require.cache[file];
      const subject = require(path.join(root, input.entry));
      await new AsyncFunction('subject', 'assert', 'clock', test.body)(subject, countedAssert, clock);
      if (assertions === 0) throw new Error('Test made no assertions');
      passed = true;
    } catch (failure) {
      error = String(failure?.stack ?? failure).slice(0, 4000);
    } finally {
      Date.now = originalNow;
      global.setTimeout = originalTimeout;
      global.setInterval = originalInterval;
      global.clearTimeout = originalClearTimeout;
      global.clearInterval = originalClearInterval;
    }
    console.log('DROID_QUALITY_RESULT ' + JSON.stringify({ name: test.name, passed, assertions, error }));
  }
}

run().catch(error => { console.error(String(error)); process.exitCode = 1; });
