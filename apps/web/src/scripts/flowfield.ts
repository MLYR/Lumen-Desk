/** 试验场：流场粒子（Canvas 2D） */
export function startFlowField(cv: HTMLCanvasElement, count: number) {
  const ctx = cv.getContext("2d")!;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, t = 0;
  let pts: { x: number; y: number }[] = [];
  function size() {
    const r = devicePixelRatio || 1; W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * r; cv.height = H * r; ctx.setTransform(r, 0, 0, r, 0, 0);
    pts = Array.from({ length: count }, () => ({ x: Math.random() * W, y: Math.random() * H }));
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--bg"); ctx.fillRect(0, 0, W, H);
  }
  function frame() {
    const cs = getComputedStyle(document.body);
    ctx.globalAlpha = 0.08; ctx.fillStyle = cs.getPropertyValue("--bg"); ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.7; ctx.fillStyle = cs.getPropertyValue("--accent");
    for (const p of pts) {
      const a = Math.sin(p.x * 0.012 + t) * Math.cos(p.y * 0.014 - t * 0.7) * Math.PI * 2;
      p.x += Math.cos(a) * 0.9; p.y += Math.sin(a) * 0.9;
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) { p.x = Math.random() * W; p.y = Math.random() * H; }
      ctx.fillRect(p.x, p.y, 1.4, 1.4);
    }
    t += 0.004;
    if (!reduce) requestAnimationFrame(frame);
  }
  size(); addEventListener("resize", size);
  if (reduce) { for (let i = 0; i < 200; i++) frame(); } else frame();
}
