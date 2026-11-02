import { useEffect, useRef } from 'react';

const IDLE_FRAME_INTERVAL_MS = 33;

interface BackgroundStar {
  readonly xNorm: number;
  readonly yNorm: number;
  readonly r: number;
  readonly minAlpha: number;
  readonly maxAlpha: number;
  readonly omega: number;
  readonly phase: number;
  readonly color: readonly [number, number, number];
}

interface SunBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly mass: number;
  readonly color: readonly [number, number, number];
  readonly trail: { x: number; y: number }[];
}

interface PlanetBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly trail: { x: number; y: number }[];
}

const STAR_PALETTE: readonly (readonly [number, number, number])[] = [
  [165, 205, 255],
  [220, 232, 255],
  [255, 214, 165],
  [200, 178, 255],
];

const SUN_COLORS: readonly (readonly [number, number, number])[] = [
  [96, 188, 255],
  [255, 192, 68],
  [255, 102, 92],
];

function buildBackgroundStars(width: number, height: number): BackgroundStar[] {
  const area = width * height;
  const count = Math.round(Math.max(70, Math.min(160, area / 6200)));
  const stars: BackgroundStar[] = [];
  for (let i = 0; i < count; i += 1) {
    const period = 3600 + Math.random() * 5400;
    stars.push({
      xNorm: Math.random(),
      yNorm: Math.random(),
      r: 0.45 + Math.random() * 0.65,
      minAlpha: 0.10 + Math.random() * 0.08,
      maxAlpha: 0.28 + Math.random() * 0.26,
      omega: (Math.PI * 2) / period,
      phase: Math.random() * Math.PI * 2,
      color: STAR_PALETTE[i % STAR_PALETTE.length],
    });
  }
  return stars;
}

function createFigureEightSystem(): { suns: SunBody[]; planet: PlanetBody } {
  const x1 = 0.97000436;
  const y1 = -0.24308753;
  const vx3 = -0.93240737;
  const vy3 = -0.86473146;

  const suns: SunBody[] = [
    { x: x1, y: y1, vx: -0.5 * vx3, vy: -0.5 * vy3, mass: 1.0, color: SUN_COLORS[0], trail: [] },
    { x: -x1, y: -y1, vx: -0.5 * vx3, vy: -0.5 * vy3, mass: 1.0, color: SUN_COLORS[1], trail: [] },
    { x: 0, y: 0, vx: vx3, vy: vy3, mass: 1.0, color: SUN_COLORS[2], trail: [] },
  ];
  const planet: PlanetBody = {
    x: 0.42,
    y: 0.36,
    vx: -0.52,
    vy: 0.64,
    trail: [],
  };

  for (let i = 0; i < 220; i += 1) {
    stepSystem(suns, planet, 0.0055);
  }
  return { suns, planet };
}

function computeAccelerations(
  state: readonly { x: number; y: number; mass: number }[],
): { ax: number; ay: number }[] {
  const eps2 = 0.012;
  const acc = [
    { ax: 0, ay: 0 },
    { ax: 0, ay: 0 },
    { ax: 0, ay: 0 },
  ];
  for (let i = 0; i < 3; i += 1) {
    for (let j = i + 1; j < 3; j += 1) {
      const dx = state[j].x - state[i].x;
      const dy = state[j].y - state[i].y;
      const r2 = dx * dx + dy * dy + eps2;
      const invR3 = 1.0 / (r2 * Math.sqrt(r2));
      acc[i].ax += dx * invR3 * state[j].mass;
      acc[i].ay += dy * invR3 * state[j].mass;
      acc[j].ax -= dx * invR3 * state[i].mass;
      acc[j].ay -= dy * invR3 * state[i].mass;
    }
  }
  return acc;
}

function stepSystem(suns: SunBody[], planet: PlanetBody, dt: number): void {
  const subSteps = 6;
  const h = dt / subSteps;

  for (let s = 0; s < subSteps; s += 1) {
    const a1 = computeAccelerations(suns);
    const s2 = suns.map((sun, i) => ({
      x: sun.x + 0.5 * h * sun.vx,
      y: sun.y + 0.5 * h * sun.vy,
      vx: sun.vx + 0.5 * h * a1[i].ax,
      vy: sun.vy + 0.5 * h * a1[i].ay,
      mass: sun.mass,
    }));
    const a2 = computeAccelerations(s2);
    const s3 = suns.map((sun, i) => ({
      x: sun.x + 0.5 * h * s2[i].vx,
      y: sun.y + 0.5 * h * s2[i].vy,
      vx: sun.vx + 0.5 * h * a2[i].ax,
      vy: sun.vy + 0.5 * h * a2[i].ay,
      mass: sun.mass,
    }));
    const a3 = computeAccelerations(s3);
    const s4 = suns.map((sun, i) => ({
      x: sun.x + h * s3[i].vx,
      y: sun.y + h * s3[i].vy,
      vx: sun.vx + h * a3[i].ax,
      vy: sun.vy + h * a3[i].ay,
      mass: sun.mass,
    }));
    const a4 = computeAccelerations(s4);

    let cmx = 0;
    let cmy = 0;
    let totalM = 0;
    for (let i = 0; i < 3; i += 1) {
      suns[i].x += (h / 6) * (suns[i].vx + 2 * s2[i].vx + 2 * s3[i].vx + s4[i].vx);
      suns[i].y += (h / 6) * (suns[i].vy + 2 * s2[i].vy + 2 * s3[i].vy + s4[i].vy);
      suns[i].vx += (h / 6) * (a1[i].ax + 2 * a2[i].ax + 2 * a3[i].ax + a4[i].ax);
      suns[i].vy += (h / 6) * (a1[i].ay + 2 * a2[i].ay + 2 * a3[i].ay + a4[i].ay);
      cmx += suns[i].x * suns[i].mass;
      cmy += suns[i].y * suns[i].mass;
      totalM += suns[i].mass;
    }
    cmx /= totalM;
    cmy /= totalM;
    for (let i = 0; i < 3; i += 1) {
      suns[i].x -= cmx;
      suns[i].y -= cmy;
    }

    let pax = 0;
    let pay = 0;
    for (let i = 0; i < 3; i += 1) {
      const dx = suns[i].x - planet.x;
      const dy = suns[i].y - planet.y;
      const r2 = dx * dx + dy * dy + 0.035;
      const invR3 = (0.85 * suns[i].mass) / (r2 * Math.sqrt(r2));
      pax += dx * invR3;
      pay += dy * invR3;
    }
    const pr = Math.hypot(planet.x, planet.y);
    if (pr > 0.98) {
      pax -= (planet.x / pr) * (pr - 0.98) * 2.2;
      pay -= (planet.y / pr) * (pr - 0.98) * 2.2;
    }
    planet.vx += pax * h;
    planet.vy += pay * h;
    const pSpd = Math.hypot(planet.vx, planet.vy);
    if (pSpd > 2.2) {
      planet.vx *= 2.2 / pSpd;
      planet.vy *= 2.2 / pSpd;
    }
    planet.x += planet.vx * h;
    planet.y += planet.vy * h;
  }

  const maxSunTrail = 220;
  for (let i = 0; i < 3; i += 1) {
    suns[i].trail.push({ x: suns[i].x, y: suns[i].y });
    if (suns[i].trail.length > maxSunTrail) suns[i].trail.shift();
  }
  planet.trail.push({ x: planet.x, y: planet.y });
  if (planet.trail.length > 150) planet.trail.shift();
}

export function ThreeBodyBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let stars: BackgroundStar[] = [];
    const { suns, planet } = createFigureEightSystem();
    let lastPaintAt = 0;
    let rafId: number | null = null;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const toScreen = (wx: number, wy: number) => {
      const scale = 0.44 * Math.min(width, height);
      return {
        x: width * 0.5 + wx * scale,
        y: height * 0.44 - wy * scale,
      };
    };

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
      stars = buildBackgroundStars(width, height);
    };

    const drawFrame = (now: number, dtScale: number) => {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);

      if (dtScale > 0) {
        stepSystem(suns, planet, 0.0052 * Math.min(2.2, dtScale * 0.55));
      }

      for (let i = 0; i < stars.length; i += 1) {
        const s = stars[i];
        const x = s.xNorm * width;
        const y = s.yNorm * height;
        const rawSin = 0.5 + 0.5 * Math.sin(now * s.omega + s.phase);
        const alpha = s.minAlpha + (s.maxAlpha - s.minAlpha) * rawSin;
        const [cr, cg, cb] = s.color;
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (planet.trail.length > 2) {
        for (let k = 1; k < planet.trail.length; k += 1) {
          const frac = k / planet.trail.length;
          const prev = toScreen(planet.trail[k - 1].x, planet.trail[k - 1].y);
          const curr = toScreen(planet.trail[k].x, planet.trail[k].y);
          ctx.strokeStyle = `rgba(148, 218, 255, ${(Math.pow(frac, 1.8) * 0.34).toFixed(3)})`;
          ctx.lineWidth = 0.6 + frac * 0.65;
          ctx.lineCap = 'butt';
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);
          ctx.stroke();
        }
      }

      const pPt = toScreen(planet.x, planet.y);
      const pGlow = ctx.createRadialGradient(pPt.x, pPt.y, 0, pPt.x, pPt.y, 5.5);
      pGlow.addColorStop(0, 'rgba(240, 249, 255, 0.92)');
      pGlow.addColorStop(0.42, 'rgba(125, 211, 252, 0.40)');
      pGlow.addColorStop(1, 'rgba(125, 211, 252, 0)');
      ctx.fillStyle = pGlow;
      ctx.beginPath();
      ctx.arc(pPt.x, pPt.y, 5.5, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < 3; i += 1) {
        const trail = suns[i].trail;
        const [r, g, b] = suns[i].color;

        if (trail.length > 3) {
          for (let k = 1; k < trail.length; k += 1) {
            const frac = k / trail.length;
            const prev = toScreen(trail[k - 1].x, trail[k - 1].y);
            const curr = toScreen(trail[k].x, trail[k].y);
            const alpha = Math.pow(frac, 1.85) * 0.46;
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 0.5 + frac * 1.65;
            ctx.lineCap = 'butt';
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.stroke();
          }
        }

        const pt = toScreen(suns[i].x, suns[i].y);
        const haloRadius = 9;
        const halo = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, haloRadius);
        halo.addColorStop(0, 'rgba(255, 250, 242, 0.92)');
        halo.addColorStop(0.24, `rgba(${r}, ${g}, ${b}, 0.50)`);
        halo.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.14)`);
        halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, haloRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = (now: number) => {
      rafId = null;
      if (document.hidden || reducedMotionQuery.matches) return;
      const elapsed = lastPaintAt > 0 ? now - lastPaintAt : IDLE_FRAME_INTERVAL_MS;
      if (elapsed >= IDLE_FRAME_INTERVAL_MS) {
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
