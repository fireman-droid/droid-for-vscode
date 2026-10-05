import { onMounted, onUnmounted } from 'vue';

// Reference parameters and intentional adaptations are recorded in docs/DESIGN.md.
const revealEase = 'cubic-bezier(0.645, 0.045, 0.355, 1)';
const scrambleGlyphs = '0123456789!<>-_/[]{}=+*^?#%&$@|~;:';

export function useHomeMotion(root) {
  let cleanup;
  onMounted(() => {
    const element = root.value;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations = new Set();
    const frames = new Set();
    const observers = [];
    const run = (target, keyframes, options) => {
      const animation = target.animate(keyframes, {
        fill: 'backwards',
        ...options,
      });
      animations.add(animation);
      animation.onfinish = () => animations.delete(animation);
    };
    const queueFrame = (callback) => {
      const frame = requestAnimationFrame((time) => {
        frames.delete(frame);
        callback(time);
      });
      frames.add(frame);
    };
    const reveal = (target) => {
      target.classList.remove('motion-pending');
      const chars = target.querySelectorAll('.motion-char');
      if (chars.length) {
        chars.forEach((char, index) =>
          run(
            char,
            [
              { opacity: 0, transform: 'translateY(50px)', color: '#ef6f2e' },
              { opacity: 1, transform: 'translateY(0)', color: '#020202' },
            ],
            { duration: 500, delay: index * 15, easing: revealEase },
          ),
        );
      } else {
        run(
          target,
          [
            { opacity: 0, transform: 'translateY(15px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          {
            duration: 800,
            delay: Number(target.dataset.delay || 0),
            easing: revealEase,
          },
        );
      }
    };
    const stop = () => {
      observers.forEach((observer) => observer.disconnect());
      frames.forEach(cancelAnimationFrame);
      frames.clear();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      element
        .querySelectorAll('.motion-pending')
        .forEach((target) => target.classList.remove('motion-pending'));
      element.querySelectorAll('.motion-char').forEach((char) => {
        char.style.removeProperty('visibility');
        char.style.removeProperty('--scramble');
      });
    };
    const preferenceChanged = () => {
      if (reduced.matches) stop();
    };
    reduced.addEventListener('change', preferenceChanged);
    cleanup = () => {
      stop();
      reduced.removeEventListener('change', preferenceChanged);
    };
    if (reduced.matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.3, rootMargin: '0px 0px -100px 0px' },
    );
    observers.push(observer);
    element
      .querySelectorAll('[data-reveal], [data-motion-text="reveal"]')
      .forEach((target) => {
        target.classList.add('motion-pending');
        observer.observe(target);
      });

    element
      .querySelectorAll('[data-motion-text="scramble"]')
      .forEach((line) => {
        const chars = Array.from(line.querySelectorAll('.motion-char')).filter(
          (char) => char.dataset.char !== ' ',
        );
        const start = performance.now() + Number(line.dataset.delay || 0);
        const ticks = new Map();
        chars.forEach((char) => {
          char.style.visibility = 'hidden';
        });
        const draw = (time) => {
          let pending = false;
          chars.forEach((char, index) => {
            const elapsed = time - start - index * 20;
            if (elapsed >= 340) {
              char.style.removeProperty('visibility');
              char.style.removeProperty('--scramble');
            } else {
              pending = true;
              if (elapsed < 0) return;
              const tick = Math.floor(elapsed / 40);
              if (ticks.get(char) === tick) return;
              ticks.set(char, tick);
              const glyph =
                elapsed > 340 * 0.72
                  ? char.dataset.char
                  : scrambleGlyphs[
                      Math.floor(Math.random() * scrambleGlyphs.length)
                    ];
              char.style.setProperty('--scramble', JSON.stringify(glyph));
            }
          });
          if (pending) queueFrame(draw);
        };
        queueFrame(draw);
      });

    // power3.out is a quartic ease-out; sample it rather than substitute a CSS ease.
    const logo = element.querySelector('[data-hero-mark]');
    if (logo)
      run(
        logo,
        Array.from({ length: 61 }, (_, index) => {
          const offset = index / 60;
          return {
            offset,
            transform: `rotate(${-540 * (1 - offset) ** 4}deg)`,
          };
        }),
        { duration: 1600, easing: 'linear' },
      );

    const marquee = element.querySelector('.model-streams');
    const visibility = new IntersectionObserver(([entry]) => {
      marquee.classList.toggle('is-visible', entry.isIntersecting);
    });
    visibility.observe(marquee);
    observers.push(visibility);
  });
  onUnmounted(() => cleanup?.());
}
