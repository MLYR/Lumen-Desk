// 试验场：流场粒子（Canvas 2D）。控制台那张演示卡和 /lab/flow-field/ 共用这一份实现。
//
// 用法：
//   const flow = startFlowField(canvas, { count: 700, speed: 1, trail: 0.08, paused: false });
//   flow.setOptions({ count: 1200 }); flow.toggle(); flow.reset(); flow.destroy();

export interface FlowFieldOptions {
  /** 粒子数 */
  count?: number;
  /** 位移和流场演化速度的倍数 */
  speed?: number;
  /** 每帧用来刷背景的透明度：越大拖尾越短 */
  trail?: number;
  /** 初始是否暂停（减少动态时用） */
  paused?: boolean;
}

export interface FlowFieldHandle {
  setOptions(patch: FlowFieldOptions): void;
  pause(): void;
  play(): void;
  toggle(): void;
  reset(): void;
  destroy(): void;
  isPaused(): boolean;
}

const DEFAULTS: Required<FlowFieldOptions> = { count: 240, speed: 1, trail: 0.08, paused: false };

export function startFlowField(cv: HTMLCanvasElement, init: FlowFieldOptions | number = {}): FlowFieldHandle {
  const ctx = cv.getContext("2d", { alpha: false });
  const opts = { ...DEFAULTS, ...(typeof init === "number" ? { count: init } : init) };

  // 拿不到 2D 上下文时返回一个空壳，调用方不用判空。
  if (!ctx) {
    return {
      setOptions() {},
      pause() {},
      play() {},
      toggle() {},
      reset() {},
      destroy() {},
      isPaused: () => true,
    };
  }

  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pts: { x: number; y: number }[] = [];
  let W = 1;
  let H = 1;
  let t = 0;
  let raf = 0;
  let paused = opts.paused;
  let bg = "#ffffff";
  let accent = "#111111";
  let destroyed = false;

  /** 主题切换后 --bg / --accent 会变，每帧读 getComputedStyle 太贵，只在需要时读一次。 */
  function readColors() {
    const cs = getComputedStyle(document.body);
    bg = cs.getPropertyValue("--bg").trim() || bg;
    accent = cs.getPropertyValue("--accent").trim() || accent;
  }

  function ensureParticles() {
    const target = Math.max(1, Math.round(opts.count));
    while (pts.length < target) pts.push({ x: Math.random() * W, y: Math.random() * H });
    if (pts.length > target) pts.length = target;
  }

  function clear() {
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  function step() {
    ctx.globalAlpha = Math.min(Math.max(opts.trail, 0.01), 1);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = 0.72;
    ctx.fillStyle = accent;
    const speed = 0.9 * opts.speed;
    for (const p of pts) {
      const a = Math.sin(p.x * 0.012 + t) * Math.cos(p.y * 0.014 - t * 0.7) * Math.PI * 2;
      p.x += Math.cos(a) * speed;
      p.y += Math.sin(a) * speed;
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
        p.x = Math.random() * W;
        p.y = Math.random() * H;
      }
      ctx.fillRect(p.x, p.y, 1.4, 1.4);
    }
    t += 0.004 * opts.speed;
  }

  function loop() {
    if (destroyed || paused) {
      raf = 0;
      return;
    }
    step();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (!raf && !paused && !document.hidden) raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /** 暂停时也要有东西可看：先跑一小段，把流场的形状定下来。 */
  function still(frames = 160) {
    clear();
    for (let i = 0; i < frames; i += 1) step();
  }

  function size() {
    W = Math.max(1, cv.clientWidth);
    H = Math.max(1, cv.clientHeight);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ensureParticles();
    if (paused) still();
    else clear();
  }

  readColors();
  size();

  const onResize = new ResizeObserver(() => size());
  onResize.observe(cv);

  // 主题切换（自动跟随时是 data-theme 变化）后重取颜色，暂停状态下重画一帧。
  const onTheme = new MutationObserver(() => {
    readColors();
    if (paused) still();
  });
  onTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const pause = () => {
    paused = true;
    stop();
    still();
  };
  const play = () => {
    paused = false;
    start();
  };
  const toggle = () => (paused ? play() : pause());

  if (paused) still();
  else start();

  return {
    setOptions(patch) {
      Object.assign(opts, patch);
      ensureParticles();
      // 调滑杆时在暂停状态也要看到新参数的效果，但别每次都跑满 160 帧。
      if (paused) still(48);
    },
    pause,
    play,
    toggle,
    reset() {
      t = 0;
      for (const p of pts) {
        p.x = Math.random() * W;
        p.y = Math.random() * H;
      }
      clear();
      if (paused) still();
    },
    destroy() {
      destroyed = true;
      stop();
      onResize.disconnect();
      onTheme.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
    isPaused: () => paused,
  };
}
