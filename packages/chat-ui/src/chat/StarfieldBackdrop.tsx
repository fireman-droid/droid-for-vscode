import { useEffect, useRef } from 'react';

const SIZE_SCALE = 1.22;
const BRIGHTNESS = 1.0;
const IDLE_FRAME_INTERVAL_MS = 40;

interface StarTint {
  readonly name: string;
  readonly halo: readonly [number, number, number];
  readonly core: readonly [number, number, number];
  readonly weight: number;
}

const TINTS: readonly StarTint[] = [
  { name: 'ice', halo: [165, 205, 255], core: [255, 255, 255], weight: 0.44 },
  { name: 'pure', halo: [220, 232, 255], core: [255, 255, 255], weight: 0.34 },
  { name: 'warm', halo: [255, 214, 165], core: [255, 253, 246], weight: 0.13 },
  { name: 'lilac', halo: [200, 178, 255], core: [252, 248, 255], weight: 0.09 },
];

function pickTint(): StarTint {
  const r = Math.random();
  let acc = 0;
  for (const t of TINTS) {
    acc += t.weight;
    if (r <= acc) return t;
  }
  return TINTS[0];
}

const spriteCache = new Map<string, HTMLCanvasElement>();

function getPinpointSprite(tint: StarTint): HTMLCanvasElement {
  const cached = spriteCache.get(tint.name);
  if (cached) return cached;
  const size = 48;
  const half = size / 2;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  if (!octx) return off;

  const [hr, hg, hb] = tint.halo;
  const [cr, cg, cb] = tint.core;
  const grad = octx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, `rgba(${cr}, ${cg}, ${cb}, 1.0)`);
  grad.addColorStop(0.11, `rgba(${cr}, ${cg}, ${cb}, 0.92)`);
  grad.addColorStop(0.2, `rgba(${hr}, ${hg}, ${hb}, 0.34)`);
  grad.addColorStop(0.36, `rgba(${hr}, ${hg}, ${hb}, 0.10)`);
  grad.addColorStop(0.62, `rgba(${hr}, ${hg}, ${hb}, 0.025)`);
  grad.addColorStop(1.0, `rgba(${hr}, ${hg}, ${hb}, 0)`);

  octx.fillStyle = grad;
  octx.beginPath();
  octx.arc(half, half, half, 0, Math.PI * 2);
  octx.fill();

  spriteCache.set(tint.name, off);
  return off;
}

interface StarParticle {
  x: number;
  y: number;
  readonly kind: 'dot' | 'sprite' | 'beacon';
  readonly r: number;
  readonly size: number;
  readonly minAlpha: number;
  readonly maxAlpha: number;
  readonly omega: number;
  readonly phase: number;
  readonly driftY: number;
  readonly tint: StarTint;
  readonly sprite: HTMLCanvasElement;
}

interface MeteorParticle {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  readonly len: number;
  life: number;
  readonly maxLife: number;
  readonly headSprite: HTMLCanvasElement;
}

function sampleSkyPos(width: number, height: number): { x: number; y: number } {
  if (Math.random() < 0.42) {
    const t = Math.random();
    const u1 = Math.max(1e-6, Math.random());
    const u2 = Math.random();
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const spread = Math.min(width, height) * 0.23;
    const x = t * width;
    const y = (0.74 - t * 0.54) * height + gauss * spread;
    return { x: (x + width) % width, y: (y + height) % height };
  }
  return { x: Math.random() * width, y: Math.random() * height };
}

function buildStars(width: number, height: number): StarParticle[] {
  const area = width * height;
  const specs = [
    {
      count: Math.round(Math.max(110, Math.min(220, area / 4200))),
      kind: 'dot' as const,
      minR: 0.4,
      maxR: 0.65,
      minAlpha: 0.14,
      maxAlpha: 0.38,
      minPeriod: 4500,
      maxPeriod: 9000,
      driftY: -0.009,
    },
    {
      count: Math.round(Math.max(48, Math.min(100, area / 9500))),
      kind: 'sprite' as const,
      minSize: 3.4,
      maxSize: 4.8,
      minAlpha: 0.18,
      maxAlpha: 0.66,
      minPeriod: 3200,
      maxPeriod: 6400,
      driftY: -0.016,
    },
    {
      count: Math.round(Math.max(24, Math.min(48, area / 19000))),
      kind: 'sprite' as const,
      minSize: 5.0,
      maxSize: 6.8,
      minAlpha: 0.15,
      maxAlpha: 0.85,
      minPeriod: 2400,
      maxPeriod: 5000,
      driftY: -0.025,
    },
    {
      count: Math.round(Math.max(8, Math.min(16, area / 56000))),
      kind: 'beacon' as const,
      minSize: 7.0,
      maxSize: 9.2,
      minAlpha: 0.2,
      maxAlpha: 0.9,
      minPeriod: 2600,
      maxPeriod: 4800,
      driftY: -0.034,
    },
  ];

  const stars: StarParticle[] = [];
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i += 1) {
      const pos = sampleSkyPos(width, height);
      const tint = pickTint();
      const period = spec.minPeriod + Math.random() * (spec.maxPeriod - spec.minPeriod);
      stars.push({
        x: pos.x,
        y: pos.y,
        kind: spec.kind,
        r: spec.minR !== undefined ? spec.minR + Math.random() * (spec.maxR - spec.minR) : 0,
        size: spec.minSize !== undefined ? spec.minSize + Math.random() * (spec.maxSize - spec.minSize) : 0,
        minAlpha: spec.minAlpha,
        maxAlpha: spec.maxAlpha * (0.85 + Math.random() * 0.15),
        omega: (Math.PI * 2) / period,
        phase: Math.random() * Math.PI * 2,
        driftY: spec.driftY * (0.75 + Math.random() * 0.5),
        tint,
        sprite: getPinpointSprite(tint),
      });
    }
  }
  return stars;
}

export function StarfieldBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let stars: StarParticle[] = [];
    let meteors: MeteorParticle[] = [];
    let nextMeteorAt = performance.now() + 6000 + Math.random() * 6000;
    let lastPaintAt = 0;
    let rafId: number | null = null;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextW = Math.round(rect.width);
      const nextH = Math.round(rect.height);
      if (!nextW || !nextH || (nextW === width && nextH === height)) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = nextW;
      height = nextH;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = buildStars(width, height);
    };

    const drawFrame = (now: number, dtScale: number) => {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);

      const invW = 2.2 / Math.max(1, width);
      const invH = 1.4 / Math.max(1, height);
      const waveT = now * 0.0004;

      for (let i = 0; i < stars.length; i += 1) {
        const s = stars[i];
        if (dtScale > 0) {
          s.y += s.driftY * dtScale;
          if (s.y < -12) {
            s.y = height + 12;
            s.x = Math.random() * width;
          }
        }
        const spatialWave = s.x * invW + s.y * invH;
        const rawSin = 0.5 + 0.5 * Math.sin(now * s.omega + s.phase + Math.sin(waveT + spatialWave) * 0.6);
        const breath = rawSin * Math.sqrt(rawSin);
        const alpha = Math.min(0.95, (s.minAlpha + (s.maxAlpha - s.minAlpha) * breath) * BRIGHTNESS);

        if (s.kind === 'dot') {
          const [hr, hg, hb] = s.tint.halo;
          ctx.fillStyle = `rgba(${hr}, ${hg}, ${hb}, ${alpha.toFixed(3)})`;
          const r = s.r * SIZE_SCALE;
          ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
        } else {
          const scale = (0.85 + 0.27 * breath) * SIZE_SCALE;
          const sz = s.size * scale;
          ctx.globalAlpha = alpha;
          ctx.drawImage(s.sprite, s.x - sz * 0.5, s.y - sz * 0.5, sz, sz);
        }
      }
      ctx.globalAlpha = 1;

      if (dtScale > 0 && now >= nextMeteorAt && meteors.length === 0) {
        const angle = (19 + Math.random() * 14) * (Math.PI / 180);
        const speed = 8 + Math.random() * 3.2;
        meteors.push({
          x: width * (0.15 + Math.random() * 0.65),
          y: height * (0.05 + Math.random() * 0.28),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          len: 85 + Math.random() * 40,
          life: 0,
          maxLife: 36 + Math.random() * 14,
          headSprite: getPinpointSprite(TINTS[0]),
        });
        nextMeteorAt = now + 9000 + Math.random() * 8000;
      }

      for (let i = meteors.length - 1; i >= 0; i -= 1) {
        const m = meteors[i];
        m.x += m.vx * dtScale;
        m.y += m.vy * dtScale;
        m.life += dtScale;
        const p = Math.min(1, m.life / m.maxLife);
        const fade = p < 0.2 ? p / 0.2 : Math.pow(1 - (p - 0.2) / 0.8, 1.4);
        const alpha = Math.max(0, Math.min(0.88, fade * 0.58 * BRIGHTNESS));

        const norm = Math.hypot(m.vx, m.vy) || 1;
        const curLen = m.len * (0.5 + 0.5 * Math.sin(p * Math.PI));
        const tx = m.x - (m.vx / norm) * curLen;
        const ty = m.y - (m.vy / norm) * curLen;

        const grad = ctx.createLinearGradient(m.x, m.y, tx, ty);
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha.toFixed(3)})`);
        grad.addColorStop(0.22, `rgba(175, 210, 255, ${(alpha * 0.65).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(135, 165, 255, 0)');

        ctx.strokeStyle = grad;
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.05 * SIZE_SCALE;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        const headSz = 6.2 * SIZE_SCALE * (0.8 + 0.2 * fade);
        ctx.globalAlpha = alpha;
        ctx.drawImage(m.headSprite, m.x - headSz * 0.5, m.y - headSz * 0.5, headSz, headSz);
        ctx.globalAlpha = 1;

        if (m.life >= m.maxLife) meteors.splice(i, 1);
      }
    };

    const tick = (now: number) => {
      rafId = null;
      if (document.hidden || reducedMotionQuery.matches) return;
      const interval = meteors.length > 0 ? 16 : IDLE_FRAME_INTERVAL_MS;
      const elapsed = lastPaintAt > 0 ? now - lastPaintAt : interval;
      if (elapsed >= interval) {
        const dtScale = Math.min(3, elapsed / 16.67);
        lastPaintAt = now;
        drawFrame(now, dtScale);
      }
      rafId = requestAnimationFrame(tick);
    };

    const startOrStop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      resize();
      if (reducedMotionQuery.matches) {
        drawFrame(performance.now(), 0);
        return;
      }
      if (!document.hidden) {
        lastPaintAt = 0;
        rafId = requestAnimationFrame(tick);
      }
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotionQuery.matches) drawFrame(performance.now(), 0);
    });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', startOrStop);
    reducedMotionQuery.addEventListener('change', startOrStop);
    startOrStop();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      document.removeEventListener('visibilitychange', startOrStop);
      reducedMotionQuery.removeEventListener('change', startOrStop);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" data-ui-notice="" className="pointer-events-none absolute inset-0 z-0 size-full select-none" />;
}
