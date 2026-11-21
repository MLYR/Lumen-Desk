import type { DB } from '../db.js';
import { kvGet, kvSet } from '../db.js';
import { writeFile } from './store.js';

/**
 * 内置实验的初始化标记。写进 kv 后就不再重复迁移：
 * 用户之后在后台改标题、改代码或删除《时间的尽头》，重启都不会被覆盖回来。
 */
export const LABS_SEEDED_KEY = 'labs_seeded';

const END_OF_TIME_SLUG = 'end-of-time';

interface SeedFile {
  path: string;
  content: string;
}

/** 《时间的尽头》的 5 个纯前端文件，保持可读排版，方便在后台编辑器里直接改。 */
const END_OF_TIME_FILES: readonly SeedFile[] = [
  {
    path: 'index.html',
    content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>时间的尽头 · 试验场 · zreo</title>
<meta name="description" content="一件用 Three.js 与程序化着色器构建的交互式作品：一座停在时间尽头的天文钟，和一片正在熄灭的星海。">
<link rel="stylesheet" href="./style.css">
<script>
  // 在试验场的 iframe 里嵌入时，给外层的返回胶囊条让出左上角。
  if (window.self !== window.top) document.documentElement.classList.add("is-embedded");
</script>
</head>
<body>
<div class="eot" id="eot" data-state="stable" data-view="far">
    <div class="eot-underlay" aria-hidden="true"></div>
    <canvas
      class="eot-canvas"
      id="eot-canvas"
      role="img"
      aria-label="悬浮在黑色海面上的破碎天文钟，中心是一颗黑色太阳，金色刻度环与玻璃碎片缓慢旋转，粒子向奇点坠落。"
    ></canvas>

    <div class="eot-flash" aria-hidden="true"></div>
    <div class="eot-scrim eot-scrim-top" aria-hidden="true"></div>
    <div class="eot-scrim eot-scrim-bottom" aria-hidden="true"></div>

    <span class="eot-corner c1" aria-hidden="true"></span>
    <span class="eot-corner c2" aria-hidden="true"></span>
    <span class="eot-corner c3" aria-hidden="true"></span>
    <span class="eot-corner c4" aria-hidden="true"></span>

    <header class="eot-top">
      <a class="eot-brand" href="/" aria-label="回到主页">
        <span class="eot-mark">z</span>
        <span>zreo</span>
      </a>
      <nav class="eot-crumb" aria-label="当前位置">
        <a href="/lab/">试验场</a>
        <span aria-hidden="true">/</span>
        <span>03</span>
      </nav>
      <div class="eot-top-right">
        <span class="eot-live"><i></i><span id="eot-live-label">LIVE</span></span>
        <span class="eot-engine">THREE.JS · WEBGL2</span>
      </div>
    </header>

    <aside class="eot-rail" aria-hidden="true">CHRONAL OBSERVATION — 03</aside>

    <section class="eot-title" aria-labelledby="eot-heading">
      <p class="eot-eyebrow"><span></span>EXPERIMENT 03 / CHRONAL OBSERVATORY</p>
      <h1 id="eot-heading">时间的尽头</h1>
      <p class="eot-en">THE END OF TIME</p>
      <p class="eot-desc">最后一枚秒针停摆之后，光仍在向引力井坠落。这里收藏着一颗正在熄灭的钟，以及所有来不及发生的事。</p>
      <p class="eot-hint" id="eot-hint">拖动环视 · 滚轮推近 · 点击画面让时间坍缩</p>
    </section>

    <div class="eot-bottom">
      <div class="eot-metrics" aria-label="观测数据">
        <div class="eot-metric">
          <span class="k">时间流速</span>
          <span class="v" id="eot-dilation">×1.00</span>
        </div>
        <div class="eot-metric">
          <span class="k">观测距离</span>
          <span class="v"><span id="eot-distance">96.0</span><small> AU</small></span>
        </div>
        <div class="eot-metric">
          <span class="k">视界状态</span>
          <span class="v v-state"><i></i><span id="eot-state">稳定</span></span>
        </div>
        <div class="eot-metric">
          <span class="k">演算帧率</span>
          <span class="v"><span id="eot-fps">60</span><small> FPS</small></span>
        </div>
      </div>

      <div class="eot-controls">
        <div class="eot-mini">
          <button class="eot-icon-btn" id="eot-pause" type="button" aria-pressed="false" aria-label="暂停时间" title="暂停时间（P）">
            <svg class="ico-pause" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4.5 3.2v9.6M11.5 3.2v9.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
            <svg class="ico-play" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M5.2 3.4 12.4 8l-7.2 4.6V3.4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="eot-icon-btn" id="eot-reset" type="button" aria-label="复位视角" title="复位视角（R）">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13 7.9A5 5 0 1 1 8.1 3H11M11 3 8.7 5.1 11 7.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

        <button class="eot-collapse" id="eot-collapse" type="button" aria-label="让时间坍缩">
          <span class="eot-orbit" aria-hidden="true"></span>
          <span class="eot-orbit eot-orbit-b" aria-hidden="true"></span>
          <span class="eot-collapse-core" aria-hidden="true"></span>
          <span class="eot-collapse-text" aria-hidden="true">坍缩</span>
        </button>
      </div>
    </div>

    <div class="eot-loading" id="eot-loading" role="status">
      <div class="eot-loader" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p>正在校准视界</p>
      <span class="eot-loading-line" aria-hidden="true"></span>
    </div>

    <div class="eot-fallback" id="eot-fallback" hidden>
      <div class="eot-fallback-mark" aria-hidden="true"></div>
      <p class="eot-fallback-kicker">SIGNAL LOST</p>
      <h2>视界没有回应</h2>
      <p id="eot-fallback-text">这台设备没有可用的 WebGL2 上下文。</p>
      <a href="/lab/">返回试验场</a>
    </div>

    <noscript>
      <div class="eot-fallback">
        <div class="eot-fallback-mark" aria-hidden="true"></div>
        <p class="eot-fallback-kicker">SCRIPT REQUIRED</p>
        <h2>时间的尽头</h2>
        <p>这个实验需要 JavaScript 和 WebGL2。请换一个开启硬件加速的浏览器再打开。</p>
        <a href="/lab/">返回试验场</a>
      </div>
    </noscript>
  </div>
<script type="module" src="./main.js"></script>
</body>
</html>
`,
  },
  {
    path: 'style.css',
    content: `/* 《时间的尽头》独立运行样式：不依赖主站 theme.css，iframe 里也能完整呈现。 */
:root {
  --mono: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  background: #02040a;
}

body {
  font: 15px/1.6 var(--sans);
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font: inherit;
  color: inherit;
}

:focus-visible {
  outline: 2px solid #d9b477;
  outline-offset: 2px;
}

/* 嵌入试验场 iframe 时，左上角留给外层的返回胶囊条，隐藏站名与面包屑。 */
.is-embedded .eot-brand,
.is-embedded .eot-crumb {
  display: none;
}

.eot {
  --gold: #d9b477;
  --gold-bright: #f2d6a4;
  --ink: #e9eef7;
  --muted: #8193a9;
  --hairline: rgba(188, 209, 235, 0.16);
  position: fixed;
  inset: 0;
  overflow: hidden;
  isolation: isolate;
  color: var(--ink);
  background: #02040a;
  user-select: none;
  -webkit-user-select: none;
}

.eot-underlay {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 62% 44%, rgba(19, 54, 83, 0.5), transparent 34%),
    radial-gradient(circle at 50% 112%, rgba(76, 35, 12, 0.28), transparent 42%),
    radial-gradient(circle at 62% 44%, #07111e 0, #02040a 54%, #010205 100%);
}

.eot-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
  opacity: 0;
  transition: opacity 1.8s ease;
}

.is-ready .eot-canvas {
  opacity: 1;
}

.is-broken .eot-canvas {
  opacity: 0;
}

.is-dragging .eot-canvas {
  cursor: grabbing;
}

.eot-flash {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: radial-gradient(circle at 60% 48%, rgba(255, 214, 158, 0.55), rgba(255, 138, 55, 0.12) 24%, transparent 56%);
  opacity: 0;
  mix-blend-mode: screen;
}

.is-collapsing .eot-flash {
  animation: eot-flash 900ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes eot-flash {
  0% { opacity: 0; }
  12% { opacity: 0.85; }
  100% { opacity: 0; }
}

.eot-scrim {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  pointer-events: none;
}

.eot-scrim-top {
  top: 0;
  height: 170px;
  background: linear-gradient(180deg, rgba(1, 3, 8, 0.78), transparent);
}

.eot-scrim-bottom {
  bottom: 0;
  height: 260px;
  background: linear-gradient(0deg, rgba(1, 3, 8, 0.9), rgba(1, 3, 8, 0.36) 52%, transparent);
}

.eot-corner {
  position: absolute;
  z-index: 8;
  width: 18px;
  height: 18px;
  border-color: rgba(224, 188, 126, 0.38);
  border-style: solid;
  pointer-events: none;
}

.eot-corner.c1 { top: 18px; left: 18px; border-width: 1px 0 0 1px; }
.eot-corner.c2 { top: 18px; right: 18px; border-width: 1px 1px 0 0; }
.eot-corner.c3 { bottom: 18px; left: 18px; border-width: 0 0 1px 1px; }
.eot-corner.c4 { bottom: 18px; right: 18px; border-width: 0 1px 1px 0; }

.eot-top {
  position: absolute;
  z-index: 10;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 30px 34px;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity 1.2s ease 0.45s, transform 1.2s ease 0.45s;
}

.is-ready .eot-top {
  opacity: 1;
  transform: none;
}

.eot-brand,
.eot-crumb a {
  pointer-events: auto;
}

.eot-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mono);
  font-size: 13px;
  letter-spacing: 0.02em;
}

.eot-mark {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  background: var(--gold);
  color: #0a0b0d;
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
}

.eot-crumb {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--muted);
}

.eot-crumb a:hover {
  color: var(--gold-bright);
}

.eot-crumb span:last-child {
  color: rgba(217, 180, 119, 0.75);
}

.eot-top-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 20px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  color: rgba(192, 208, 228, 0.52);
}

.eot-live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.eot-live i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #7bd8b0;
  box-shadow: 0 0 8px #7bd8b0;
  animation: eot-pulse 2.8s ease-in-out infinite;
}

.is-paused .eot-live i {
  background: #c49a5f;
  box-shadow: 0 0 8px rgba(196, 154, 95, 0.8);
  animation: none;
}

[data-state="collapse"] .eot-live i {
  background: #ff9b55;
  box-shadow: 0 0 12px #ff8a45;
  animation-duration: 0.55s;
}

@keyframes eot-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.1); }
}

.eot-engine {
  padding-left: 18px;
  border-left: 1px solid var(--hairline);
}

.eot-rail {
  position: absolute;
  z-index: 8;
  top: 50%;
  right: 20px;
  transform: translateY(-50%);
  writing-mode: vertical-rl;
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.42em;
  color: rgba(193, 208, 228, 0.28);
  pointer-events: none;
}

.eot-title {
  position: absolute;
  z-index: 9;
  left: 46px;
  bottom: 144px;
  max-width: min(520px, 42vw);
  padding-left: 24px;
  border-left: 1px solid rgba(217, 180, 119, 0.38);
  pointer-events: none;
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.9s ease, transform 0.9s cubic-bezier(0.16, 1, 0.3, 1);
}

.is-ready .eot-title {
  opacity: 1;
  transform: none;
}

.eot[data-view="close"] .eot-title {
  opacity: 0.12;
  transform: translateY(12px);
}

.eot-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.24em;
  color: rgba(217, 180, 119, 0.82);
  white-space: nowrap;
}

.eot-eyebrow span {
  width: 26px;
  height: 1px;
  background: rgba(217, 180, 119, 0.6);
}

.eot-title h1 {
  margin: 18px 0 0 -5px;
  font-family: "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", "Times New Roman", serif;
  font-size: clamp(52px, 6.2vw, 88px);
  font-weight: 300;
  line-height: 0.98;
  letter-spacing: 0.075em;
  color: #f3e9d4;
  text-shadow: 0 4px 54px rgba(0, 0, 0, 0.62), 0 0 26px rgba(255, 196, 109, 0.08);
  white-space: nowrap;
}

.is-ready .eot-title h1 {
  animation: eot-title-in 2.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes eot-title-in {
  0% { letter-spacing: 0.14em; opacity: 0; filter: blur(7px); }
  100% { letter-spacing: 0.075em; opacity: 1; filter: blur(0); }
}

.eot-en {
  margin-top: 17px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.54em;
  color: rgba(217, 180, 119, 0.7);
}

.eot-desc {
  max-width: 31em;
  margin-top: 20px;
  font-size: 12.5px;
  line-height: 2;
  letter-spacing: 0.03em;
  color: rgba(204, 218, 237, 0.62);
}

.eot-hint {
  margin-top: 24px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: rgba(159, 177, 199, 0.52);
}

.eot-bottom {
  position: absolute;
  z-index: 10;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  padding: 0 36px 28px 46px;
  pointer-events: none;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 1.2s ease 1s, transform 1.2s ease 1s;
}

.is-ready .eot-bottom {
  opacity: 1;
  transform: none;
}

.eot-metrics {
  display: flex;
  gap: 30px;
  padding-top: 11px;
  border-top: 1px solid var(--hairline);
  min-width: 400px;
}

.eot-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.eot-metric .k {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.18em;
  color: rgba(142, 160, 182, 0.62);
}

.eot-metric .v {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  color: rgba(228, 236, 247, 0.9);
  font-variant-numeric: tabular-nums;
}

.eot-metric small {
  font-size: 8px;
  color: rgba(142, 160, 182, 0.6);
}

.v-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.v-state i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #7bd8b0;
  box-shadow: 0 0 7px rgba(123, 216, 176, 0.9);
}

[data-state="paused"] .v-state i {
  background: #c49a5f;
  box-shadow: 0 0 7px rgba(196, 154, 95, 0.8);
}

[data-state="collapse"] .v-state i {
  background: #ff9b55;
  box-shadow: 0 0 9px #ff8a45;
}

.eot-controls {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  pointer-events: auto;
}

.eot-mini {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 4px;
}

.eot-icon-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(199, 216, 238, 0.18);
  background: rgba(7, 14, 24, 0.46);
  color: rgba(219, 229, 243, 0.72);
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: color 0.25s, border-color 0.25s, background 0.25s;
}

.eot-icon-btn:hover {
  color: var(--gold-bright);
  border-color: rgba(217, 180, 119, 0.55);
  background: rgba(30, 23, 13, 0.5);
}

.eot-icon-btn .ico-play {
  display: none;
}

.is-paused .eot-icon-btn .ico-pause {
  display: none;
}

.is-paused .eot-icon-btn .ico-play {
  display: block;
}

.eot-collapse {
  position: relative;
  display: grid;
  place-items: center;
  width: 94px;
  height: 94px;
  padding: 0;
  border: 1px solid rgba(217, 180, 119, 0.35);
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(13, 16, 20, 0.9) 0 26%, rgba(4, 7, 11, 0.64) 27% 100%);
  color: var(--gold-bright);
  cursor: pointer;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: inset 0 0 40px rgba(255, 154, 69, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.4);
  transition: border-color 0.3s, box-shadow 0.3s, transform 0.3s;
}

.eot-collapse:hover {
  border-color: rgba(242, 211, 160, 0.85);
  box-shadow: inset 0 0 48px rgba(255, 154, 69, 0.12), 0 0 32px rgba(255, 154, 69, 0.12);
  transform: scale(1.02);
}

.eot-collapse:active {
  transform: scale(0.97);
}

.eot-orbit {
  position: absolute;
  inset: 8px;
  border: 1px solid rgba(217, 180, 119, 0.25);
  border-right-color: rgba(242, 211, 160, 0.8);
  border-radius: 50%;
  animation: eot-orbit 18s linear infinite;
}

.eot-orbit-b {
  inset: 19px;
  border-color: rgba(142, 168, 200, 0.2);
  border-left-color: rgba(191, 219, 250, 0.7);
  animation-duration: 11s;
  animation-direction: reverse;
}

@keyframes eot-orbit {
  to { transform: rotate(360deg); }
}

.eot-collapse-core {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #010204;
  box-shadow: 0 0 0 1px rgba(242, 211, 160, 0.75), 0 0 16px rgba(255, 154, 69, 0.55);
  transition: box-shadow 0.3s, transform 0.3s;
}

.eot-collapse:hover .eot-collapse-core {
  transform: scale(1.35);
  box-shadow: 0 0 0 1px #f2d3a0, 0 0 26px rgba(255, 154, 69, 0.8);
}

.eot-collapse-text {
  position: absolute;
  bottom: -22px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.24em;
  color: rgba(217, 180, 119, 0.66);
  white-space: nowrap;
}

.eot-loading {
  position: absolute;
  z-index: 30;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  background: radial-gradient(circle at 62% 44%, #06101c 0, #02040a 52%, #010205 100%);
  transition: opacity 1s ease, visibility 1s;
}

.is-ready .eot-loading,
.is-broken .eot-loading {
  opacity: 0;
  visibility: hidden;
}

.eot-loader {
  position: relative;
  width: 58px;
  height: 58px;
}

.eot-loader span {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(217, 180, 119, 0.22);
  border-radius: 50%;
}

.eot-loader span:nth-child(1) {
  border-top-color: rgba(242, 211, 160, 0.9);
  animation: eot-orbit 2.6s linear infinite;
}

.eot-loader span:nth-child(2) {
  inset: 10px;
  border-left-color: rgba(150, 188, 230, 0.8);
  animation: eot-orbit 3.8s linear reverse infinite;
}

.eot-loader span:nth-child(3) {
  inset: 24px;
  background: #02040a;
  box-shadow: 0 0 14px rgba(255, 154, 69, 0.4);
  animation: eot-pulse 2s ease-in-out infinite;
}

.eot-loading p {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.36em;
  color: rgba(199, 212, 230, 0.62);
}

.eot-loading-line {
  width: 112px;
  height: 1px;
  overflow: hidden;
  background: rgba(160, 180, 205, 0.14);
}

.eot-loading-line::after {
  content: "";
  display: block;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(242, 211, 160, 0.85), transparent);
  animation: eot-scan 1.6s ease-in-out infinite;
}

@keyframes eot-scan {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

.eot-fallback {
  position: absolute;
  z-index: 40;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  background: radial-gradient(circle at 50% 40%, #0a1624 0, #02040a 58%);
}

.eot-fallback[hidden] {
  display: none;
}

.eot-fallback-mark {
  width: 74px;
  height: 74px;
  margin-bottom: 12px;
  border: 1px solid rgba(217, 180, 119, 0.28);
  border-radius: 50%;
  box-shadow: inset 0 0 30px rgba(255, 154, 69, 0.1);
}

.eot-fallback-kicker {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.32em;
  color: rgba(217, 180, 119, 0.7);
}

.eot-fallback h2 {
  font-family: "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif;
  font-size: 34px;
  font-weight: 300;
  letter-spacing: 0.08em;
  color: #f0e4cd;
}

.eot-fallback p:not(.eot-fallback-kicker) {
  max-width: 32em;
  font-size: 13px;
  line-height: 1.9;
  color: var(--muted);
}

.eot-fallback a {
  margin-top: 14px;
  padding: 9px 16px;
  border: 1px solid rgba(217, 180, 119, 0.4);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--gold-bright);
}

.eot-fallback a:hover {
  border-color: var(--gold-bright);
  background: rgba(217, 180, 119, 0.08);
}

@media (max-width: 900px) {
  .eot-title {
    left: 28px;
    bottom: 130px;
    max-width: 46vw;
    padding-left: 18px;
  }
  .eot-bottom {
    padding-left: 30px;
    padding-right: 28px;
  }
  .eot-metrics {
    min-width: 0;
    gap: 22px;
  }
  .eot-rail {
    display: none;
  }
}

@media (max-width: 700px) {
  .eot-top {
    padding: calc(18px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) 18px calc(18px + env(safe-area-inset-left));
    gap: 14px;
  }
  .eot-engine {
    display: none;
  }
  .eot-top-right {
    gap: 0;
  }
  .eot-title {
    top: calc(74px + env(safe-area-inset-top));
    bottom: auto;
    left: calc(18px + env(safe-area-inset-left));
    right: calc(18px + env(safe-area-inset-right));
    max-width: none;
    padding-left: 14px;
  }
  .eot-title h1 {
    margin-top: 14px;
    font-size: clamp(42px, 13.5vw, 66px);
    letter-spacing: 0.06em;
  }
  .eot-eyebrow {
    font-size: 8px;
    letter-spacing: 0.16em;
  }
  .eot-eyebrow span {
    width: 18px;
  }
  .eot-en {
    margin-top: 12px;
    font-size: 8px;
    letter-spacing: 0.38em;
  }
  .eot-desc,
  .eot-hint {
    display: none;
  }
  .eot-bottom {
    align-items: flex-end;
    padding: 0 calc(18px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left));
    gap: 12px;
  }
  .eot-metrics {
    display: grid;
    grid-template-columns: auto auto;
    gap: 9px 18px;
    border-top: 0;
    padding: 0 0 2px;
  }
  .eot-metric:nth-child(2),
  .eot-metric:nth-child(4) {
    display: none;
  }
  .eot-metric .k {
    font-size: 7px;
  }
  .eot-metric .v {
    font-size: 11px;
  }
  .eot-mini {
    display: flex;
    flex-direction: row;
    gap: 6px;
    padding-bottom: 4px;
  }
  .eot-icon-btn {
    width: 34px;
    height: 34px;
  }
  .eot-controls {
    padding-bottom: 4px;
  }
  .eot-collapse {
    width: 70px;
    height: 70px;
  }
  .eot-collapse-text {
    bottom: -18px;
    font-size: 8px;
  }
  .eot-orbit {
    inset: 6px;
  }
  .eot-orbit-b {
    inset: 15px;
  }
  .eot-scrim-bottom {
    height: 220px;
  }
  .eot-corner {
    width: 12px;
    height: 12px;
  }
  .eot-corner.c1 { top: 12px; left: 12px; }
  .eot-corner.c2 { top: 12px; right: 12px; }
  .eot-corner.c3 { bottom: 12px; left: 12px; }
  .eot-corner.c4 { bottom: 12px; right: 12px; }
}

@media (max-height: 620px) and (min-width: 701px) {
  .eot-title {
    bottom: 108px;
  }
  .eot-title h1 {
    font-size: clamp(46px, 5.4vw, 74px);
  }
  .eot-desc,
  .eot-hint {
    display: none;
  }
  .eot-bottom {
    padding-bottom: 18px;
  }
  .eot-collapse {
    width: 76px;
    height: 76px;
  }
  .eot-collapse-text {
    display: none;
  }
}

@media (max-width: 360px) {
  .eot-bottom {
    gap: 8px;
  }
  .eot-icon-btn {
    width: 30px;
    height: 30px;
  }
  .eot-collapse {
    width: 62px;
    height: 62px;
  }
  .eot-collapse-text {
    display: none;
  }
  .eot-metric .v {
    font-size: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .eot-canvas,
  .eot-top,
  .eot-title,
  .eot-bottom,
  .eot-loading {
    transition-duration: 0.01ms !important;
  }
  .eot-loader span,
  .eot-live i,
  .eot-orbit,
  .eot-loading-line::after,
  .is-ready .eot-title h1 {
    animation: none !important;
  }
  .eot-loader span:nth-child(3) {
    opacity: 0.8;
  }
  .is-collapsing .eot-flash {
    animation-duration: 1.4s;
  }
}
`,
  },
  {
    path: 'main.js',
    content: `import { createEndOfTime } from "./engine.js";
function boot() {
    const root = document.getElementById("eot");
    const canvas = document.getElementById("eot-canvas");
    if (!root || !canvas)
        return;
    const loading = document.getElementById("eot-loading");
    const fallback = document.getElementById("eot-fallback");
    const fallbackText = document.getElementById("eot-fallback-text");
    const pauseButton = document.getElementById("eot-pause");
    const collapseButton = document.getElementById("eot-collapse");
    const resetButton = document.getElementById("eot-reset");
    const dilationNode = document.getElementById("eot-dilation");
    const distanceNode = document.getElementById("eot-distance");
    const stateNode = document.getElementById("eot-state");
    const fpsNode = document.getElementById("eot-fps");
    const hint = document.getElementById("eot-hint");
    const liveLabel = document.getElementById("eot-live-label");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let handle = null;
    let paused = reducedMotion;
    let closeView = false;
    const showFallback = (message) => {
        root.classList.add("is-broken");
        root.classList.remove("is-loading");
        if (fallbackText)
            fallbackText.textContent = message;
        if (fallback)
            fallback.hidden = false;
    };
    const syncPause = () => {
        if (!pauseButton)
            return;
        pauseButton.setAttribute("aria-pressed", paused ? "true" : "false");
        pauseButton.setAttribute("aria-label", paused ? "继续时间" : "暂停时间");
        pauseButton.title = paused ? "继续时间（P）" : "暂停时间（P）";
        if (liveLabel)
            liveLabel.textContent = paused ? "PAUSED" : "LIVE";
        root.classList.toggle("is-paused", paused);
    };
    const setPaused = (value) => {
        paused = value;
        handle?.setPaused(value);
        syncPause();
    };
    if (hint) {
        hint.textContent = reducedMotion
            ? "系统已请求减少动态，时间暂停。按播放继续，或点击画面让时间坍缩。"
            : "拖动环视 · 滚轮推近 · 点击画面让时间坍缩";
    }
    try {
        handle = createEndOfTime(canvas, {
            reducedMotion,
            onReady: () => {
                root.classList.remove("is-loading");
                root.classList.add("is-ready");
                loading?.setAttribute("aria-hidden", "true");
                if (reducedMotion)
                    setPaused(true);
            },
            onTelemetry: (telemetry) => {
                paused = telemetry.paused;
                syncPause();
                if (dilationNode)
                    dilationNode.textContent = \`×\${telemetry.dilation.toFixed(2)}\`;
                if (distanceNode)
                    distanceNode.textContent = telemetry.distance.toFixed(1);
                if (fpsNode)
                    fpsNode.textContent = \`\${Math.round(telemetry.fps)}\`;
                if (stateNode) {
                    const state = telemetry.paused ? "静默" : telemetry.energy > 0.08 ? "坍缩" : "稳定";
                    if (stateNode.textContent !== state)
                        stateNode.textContent = state;
                }
                const nextClose = closeView ? telemetry.distance < 92 : telemetry.distance < 82;
                if (nextClose !== closeView) {
                    closeView = nextClose;
                    root.dataset.view = closeView ? "close" : "far";
                }
                root.dataset.state = telemetry.paused
                    ? "paused"
                    : telemetry.energy > 0.08
                        ? "collapse"
                        : "stable";
            },
            onError: (message) => showFallback(message),
        });
    }
    catch (error) {
        console.error(error);
        showFallback("这台设备没有可用的 WebGL2 上下文。换一个支持硬件加速的浏览器再试。");
        return;
    }
    syncPause();
    const collapse = () => {
        if (!handle)
            return;
        handle.collapse();
        paused = false;
        syncPause();
        root.classList.remove("is-collapsing");
        void root.offsetWidth;
        root.classList.add("is-collapsing");
        window.setTimeout(() => root.classList.remove("is-collapsing"), 900);
        if (navigator.vibrate)
            navigator.vibrate(18);
    };
    collapseButton?.addEventListener("click", collapse);
    pauseButton?.addEventListener("click", () => setPaused(!paused));
    resetButton?.addEventListener("click", () => handle?.resetView());
    window.addEventListener("keydown", (event) => {
        const target = event.target;
        if (target?.closest("button, a, input, textarea, select"))
            return;
        if (event.code === "Space") {
            event.preventDefault();
            collapse();
        }
        else if (event.key.toLowerCase() === "p") {
            event.preventDefault();
            setPaused(!paused);
        }
        else if (event.key.toLowerCase() === "r") {
            event.preventDefault();
            handle?.resetView();
        }
    });
    const timeout = window.setTimeout(() => {
        if (!root.classList.contains("is-ready") && !root.classList.contains("is-broken")) {
            showFallback("视界响应超时。请刷新页面，或检查浏览器是否开启了硬件加速。");
        }
    }, 12000);
    window.addEventListener("pagehide", () => window.clearTimeout(timeout), { once: true });
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
}
else {
    boot();
}
`,
  },
  {
    path: 'engine.js',
    content: `import {
  THREE,
  EffectComposer,
  RenderPass,
  ShaderPass,
  UnrealBloomPass,
  OutputPass,
} from "/lab/vendor/three-eot.mjs";
import {
  coronaFragment,
  coronaVertex,
  finalPassShader,
  haloFragment,
  inflowFragment,
  inflowVertex,
  moteFragment,
  moteVertex,
  ringEngraveFragment,
  ringEngraveVertex,
  seaFragment,
  seaVertex,
  skyFragment,
  skyVertex,
  starFragment,
  starVertex,
  vortexFragment,
  vortexVertex,
} from "./shaders.js";
const TAU = Math.PI * 2;
function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}
function makeEnvironmentMap(renderer) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("无法创建环境贴图画布");
    const vertical = ctx.createLinearGradient(0, 0, 0, canvas.height);
    vertical.addColorStop(0, "#030817");
    vertical.addColorStop(0.38, "#07152c");
    vertical.addColorStop(0.53, "#07101f");
    vertical.addColorStop(0.62, "#150a05");
    vertical.addColorStop(1, "#010205");
    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const horizon = ctx.createLinearGradient(0, 238, 0, 342);
    horizon.addColorStop(0, "rgba(68,42,20,0)");
    horizon.addColorStop(0.52, "rgba(152,83,30,0.55)");
    horizon.addColorStop(1, "rgba(20,8,3,0)");
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 220, canvas.width, 140);
    const warm = ctx.createRadialGradient(230, 185, 4, 230, 185, 250);
    warm.addColorStop(0, "rgba(255,220,164,0.62)");
    warm.addColorStop(0.18, "rgba(255,164,78,0.32)");
    warm.addColorStop(0.62, "rgba(118,52,12,0.10)");
    warm.addColorStop(1, "rgba(8,4,2,0)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, 620, 512);
    const cool = ctx.createRadialGradient(820, 320, 8, 820, 320, 280);
    cool.addColorStop(0, "rgba(140,198,255,0.36)");
    cool.addColorStop(0.42, "rgba(36,98,170,0.14)");
    cool.addColorStop(1, "rgba(2,8,18,0)");
    ctx.fillStyle = cool;
    ctx.fillRect(420, 0, 604, 512);
    const texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromEquirectangular(texture);
    pmrem.dispose();
    texture.dispose();
    return target.texture;
}
function makeClockFaceTexture(renderer) {
    const size = 2048;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("无法创建表盘画布");
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = "butt";
    ctx.strokeStyle = "rgba(224,210,182,0.22)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, c - 28, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(224,210,182,0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, c - 318, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 60; i++) {
        const angle = -Math.PI / 2 + (i / 60) * TAU;
        const major = i % 5 === 0;
        const inner = c - (major ? 108 : 68);
        const outer = c - 40;
        ctx.strokeStyle = major ? "rgba(240,224,192,0.46)" : "rgba(210,198,176,0.22)";
        ctx.lineWidth = major ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(angle) * inner, c + Math.sin(angle) * inner);
        ctx.lineTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
        ctx.stroke();
    }
    ctx.fillStyle = "rgba(242,229,203,0.52)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '500 116px "Times New Roman", "Songti SC", serif';
    const numerals = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
    numerals.forEach((numeral, index) => {
        const angle = -Math.PI / 2 + (index / 12) * TAU;
        const radius = c - 205;
        ctx.fillText(numeral, c + Math.cos(angle) * radius, c + Math.sin(angle) * radius);
    });
    ctx.strokeStyle = "rgba(132,170,210,0.12)";
    ctx.lineWidth = 2;
    const cracks = [
        { angle: -0.62, length: 780 },
        { angle: 1.44, length: 640 },
        { angle: 3.72, length: 820 },
    ];
    for (const crack of cracks) {
        ctx.beginPath();
        let x = c + Math.cos(crack.angle) * 300;
        let y = c + Math.sin(crack.angle) * 300;
        ctx.moveTo(x, y);
        for (let step = 1; step <= 9; step++) {
            const radius = 300 + (crack.length * step) / 9;
            const wobble = Math.sin(step * 4.7 + crack.angle * 5) * 25;
            x = c + Math.cos(crack.angle) * radius - Math.sin(crack.angle) * wobble;
            y = c + Math.sin(crack.angle) * radius + Math.cos(crack.angle) * wobble;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
}
function makeGlowMaterial(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({
        vertexShader: coronaVertex,
        fragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
}
function buildStarField(count) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const palette = [
        new THREE.Color("#cfe4ff"),
        new THREE.Color("#9fc4f2"),
        new THREE.Color("#ffe2b8"),
        new THREE.Color("#f4f7ff"),
    ];
    for (let i = 0; i < count; i++) {
        const radius = randomBetween(250, 390);
        const theta = Math.random() * TAU;
        const cosPhi = randomBetween(-0.75, 1);
        const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
        positions[i * 3] = Math.cos(theta) * sinPhi * radius;
        positions[i * 3 + 1] = cosPhi * radius * 0.72 - 15;
        positions[i * 3 + 2] = Math.sin(theta) * sinPhi * radius;
        sizes[i] = Math.random() < 0.03 ? randomBetween(1.9, 2.9) : randomBetween(0.5, 1.35);
        phases[i] = Math.random();
        const color = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -5;
    return points;
}
function buildMotes(count) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const palette = [
        new THREE.Color("#8fc4ef"),
        new THREE.Color("#f4e4c8"),
        new THREE.Color("#f0a66a"),
        new THREE.Color("#d6ecff"),
    ];
    for (let i = 0; i < count; i++) {
        positions[i * 3] = randomBetween(-110, 110);
        positions[i * 3 + 1] = randomBetween(-38, 82);
        positions[i * 3 + 2] = randomBetween(-90, 90);
        sizes[i] = randomBetween(0.35, 1.2);
        phases[i] = Math.random();
        const color = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
        vertexShader: moteVertex,
        fragmentShader: moteFragment,
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 12;
    return points;
}
function buildInflow(count) {
    const seeds = new Float32Array(count);
    const angles = new Float32Array(count);
    const radii = new Float32Array(count);
    const heights = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const tints = new Float32Array(count);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        seeds[i] = Math.random();
        const clustered = Math.random() < 0.72;
        angles[i] = clustered
            ? (Math.floor(Math.random() * 3) / 3) * TAU + randomBetween(-0.24, 0.24)
            : Math.random() * TAU;
        radii[i] = 8.4 + Math.pow(Math.random(), 0.62) * 30;
        heights[i] = randomBetween(-1, 1) * (0.9 + (radii[i] - 8) * 0.14);
        speeds[i] = randomBetween(0.55, 1.5);
        sizes[i] = Math.random() < 0.025 ? randomBetween(1.8, 2.6) : randomBetween(0.45, 1.35);
        tints[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
    geometry.setAttribute("aRadius", new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute("aZ", new THREE.BufferAttribute(heights, 1));
    geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aTint", new THREE.BufferAttribute(tints, 1));
    const material = new THREE.ShaderMaterial({
        vertexShader: inflowVertex,
        fragmentShader: inflowFragment,
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: 1 },
            uCollapse: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 8;
    return points;
}
function makeShardSystem(count, material) {
    const geometry = new THREE.OctahedronGeometry(1, 0);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    const data = [];
    for (let i = 0; i < count; i++) {
        data.push({
            r: randomBetween(10.5, 40),
            a: Math.random() * TAU,
            z: randomBetween(-13, 12),
            sx: randomBetween(0.055, 0.22),
            sy: randomBetween(0.025, 0.08),
            sz: randomBetween(0.45, 2.55),
            rx: Math.random() * TAU,
            ry: Math.random() * TAU,
            rz: Math.random() * TAU,
            vx: randomBetween(-0.11, 0.11),
            vy: randomBetween(-0.14, 0.14),
            vz: randomBetween(-0.09, 0.09),
            speed: randomBetween(-0.014, 0.014),
            phase: Math.random() * TAU,
            drift: randomBetween(0.15, 0.9),
        });
    }
    return { mesh, data };
}
function setShardMatrices(system, time, energy) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < system.data.length; i++) {
        const d = system.data[i];
        const angle = d.a + time * d.speed;
        const radius = d.r + Math.sin(time * 0.16 + d.phase) * d.drift;
        dummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, d.z + Math.cos(time * 0.12 + d.phase) * 0.45);
        dummy.rotation.set(d.rx + time * d.vx, d.ry + time * d.vy, d.rz + time * d.vz);
        const scale = 1 + energy * 0.08;
        dummy.scale.set(d.sx * scale, d.sy * scale, d.sz * scale);
        dummy.updateMatrix();
        system.mesh.setMatrixAt(i, dummy.matrix);
    }
    system.mesh.instanceMatrix.needsUpdate = true;
}
function makeHandGeometry(length, width) {
    const shape = new THREE.Shape();
    shape.moveTo(-width, 0);
    shape.lineTo(-width * 0.78, length * 0.82);
    shape.lineTo(-width * 0.16, length * 0.96);
    shape.lineTo(0, length);
    shape.lineTo(width * 0.16, length * 0.96);
    shape.lineTo(width * 0.78, length * 0.82);
    shape.lineTo(width, 0);
    shape.lineTo(width * 0.22, -width * 2.2);
    shape.lineTo(-width * 0.22, -width * 2.2);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
        depth: 0.34,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.035,
        bevelSegments: 2,
        steps: 1,
    });
}
export function createEndOfTime(canvas, options = {}) {
    const parent = canvas.parentElement ?? canvas;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const reducedMotion = options.reducedMotion ?? false;
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
        stencil: false,
    });
    renderer.setClearColor(0x02040a, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02040a, 0.0015);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
    const clockGroup = new THREE.Group();
    clockGroup.position.set(0, 6, 0);
    scene.add(clockGroup);
    const envTexture = makeEnvironmentMap(renderer);
    scene.environment = envTexture;
    scene.environmentIntensity = 1.05;
    const disposables = [envTexture];
    const materials = [];
    const geometries = [];
    const track = (material) => {
        materials.push(material);
        return material;
    };
    const trackGeometry = (geometry) => {
        geometries.push(geometry);
        return geometry;
    };
    // ---------- sky ----------
    const skyMaterial = new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        uniforms: { uTime: { value: 0 } },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
    });
    const sky = new THREE.Mesh(trackGeometry(new THREE.SphereGeometry(420, 48, 32)), skyMaterial);
    sky.renderOrder = -100;
    sky.frustumCulled = false;
    scene.add(sky);
    track(skyMaterial);
    const starCount = coarsePointer ? 2000 : 3200;
    const stars = buildStarField(starCount);
    const starMaterial = stars.material;
    trackGeometry(stars.geometry);
    track(starMaterial);
    scene.add(stars);
    // ---------- lighting ----------
    scene.add(new THREE.HemisphereLight(0x27486f, 0x040202, 0.62));
    const keyLight = new THREE.DirectionalLight(0xffc08a, 3.1);
    keyLight.position.set(28, 42, 46);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x5f9fdf, 2.8);
    rimLight.position.set(-55, 26, 34);
    scene.add(rimLight);
    const coreLight = new THREE.PointLight(0xff7a30, 210, 110, 2);
    coreLight.position.set(0, 0, 0);
    clockGroup.add(coreLight);
    // ---------- the black sun ----------
    const sunMaterial = new THREE.ShaderMaterial({
        vertexShader: /* glsl */ \`
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    \`,
        fragmentShader: /* glsl */ \`
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = clamp(1.0 - abs(dot(vNormal, vView)), 0.0, 1.0);
        float rim = pow(facing, 4.2);
        vec3 col = vec3(0.0);
        col += vec3(1.0, 0.34, 0.08) * rim * 0.24;
        col += vec3(0.20, 0.42, 0.78) * pow(facing, 8.0) * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }
    \`,
        fog: false,
    });
    const sun = new THREE.Mesh(trackGeometry(new THREE.SphereGeometry(7, 64, 48)), sunMaterial);
    sun.renderOrder = 2;
    clockGroup.add(sun);
    track(sunMaterial);
    const coronaMaterial = makeGlowMaterial(coronaFragment, {
        uTime: { value: 0 },
        uIntensity: { value: 0.9 },
    });
    const corona = new THREE.Mesh(trackGeometry(new THREE.PlaneGeometry(34, 34)), coronaMaterial);
    corona.renderOrder = 4;
    clockGroup.add(corona);
    track(coronaMaterial);
    const haloMaterial = makeGlowMaterial(haloFragment, {
        uTime: { value: 0 },
        uIntensity: { value: 0.52 },
    });
    const halo = new THREE.Mesh(trackGeometry(new THREE.PlaneGeometry(82, 82)), haloMaterial);
    halo.renderOrder = 1;
    clockGroup.add(halo);
    track(haloMaterial);
    // ---------- the ghost clock face ----------
    const clockFaceTexture = makeClockFaceTexture(renderer);
    disposables.push(clockFaceTexture);
    const clockFaceMaterial = new THREE.MeshBasicMaterial({
        map: clockFaceTexture,
        transparent: true,
        opacity: 0.33,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const clockFace = new THREE.Mesh(trackGeometry(new THREE.PlaneGeometry(66, 66)), clockFaceMaterial);
    clockFace.position.z = -1.4;
    clockFace.renderOrder = 1;
    clockGroup.add(clockFace);
    track(clockFaceMaterial);
    // ---------- the chronal vortex ----------
    const vortexMaterial = new THREE.ShaderMaterial({
        vertexShader: vortexVertex,
        fragmentShader: vortexFragment,
        uniforms: {
            uTime: { value: 0 },
            uIntensity: { value: 1 },
            uInner: { value: 8.35 },
            uOuter: { value: 27.5 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const vortex = new THREE.Mesh(trackGeometry(new THREE.RingGeometry(8.35, 27.5, 256, 1)), vortexMaterial);
    vortex.rotation.x = -Math.PI / 2 + 0.24;
    vortex.rotation.z = 0.1;
    vortex.renderOrder = 3;
    clockGroup.add(vortex);
    track(vortexMaterial);
    const vortexEchoMaterial = new THREE.ShaderMaterial({
        vertexShader: vortexVertex,
        fragmentShader: vortexFragment,
        uniforms: {
            uTime: { value: 0 },
            uIntensity: { value: 0.22 },
            uInner: { value: 9.2 },
            uOuter: { value: 34 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const vortexEcho = new THREE.Mesh(trackGeometry(new THREE.RingGeometry(9.2, 34, 256, 1)), vortexEchoMaterial);
    vortexEcho.rotation.x = -Math.PI / 2 - 0.42;
    vortexEcho.rotation.y = 0.3;
    vortexEcho.renderOrder = 2;
    clockGroup.add(vortexEcho);
    track(vortexEchoMaterial);
    // ---------- rings ----------
    const ringMaterial = track(new THREE.MeshStandardMaterial({
        color: 0x46351f,
        metalness: 1,
        roughness: 0.23,
        envMapIntensity: 1.5,
        emissive: 0x070301,
        emissiveIntensity: 1,
    }));
    const ringMaterialPale = track(new THREE.MeshStandardMaterial({
        color: 0x55422a,
        metalness: 1,
        roughness: 0.28,
        envMapIntensity: 1.15,
        emissive: 0x090502,
        emissiveIntensity: 1,
    }));
    const darkMetalMaterial = track(new THREE.MeshStandardMaterial({
        color: 0x17110a,
        metalness: 1,
        roughness: 0.24,
        envMapIntensity: 1.45,
        emissive: 0x050301,
        emissiveIntensity: 1,
    }));
    const tickMaterial = track(new THREE.MeshStandardMaterial({
        color: 0xb08a4e,
        metalness: 1,
        roughness: 0.28,
        envMapIntensity: 1.8,
        emissive: 0x3b2108,
        emissiveIntensity: 1.15,
    }));
    const rings = [];
    function addRing(config) {
        const group = new THREE.Group();
        group.position.z = config.z;
        group.rotation.x = config.tiltX ?? 0;
        group.rotation.y = config.tiltY ?? 0;
        const material = config.pale ? ringMaterialPale : ringMaterial;
        for (const [start, length] of config.arcs) {
            const torus = new THREE.Mesh(trackGeometry(new THREE.TorusGeometry(config.radius, config.tube, 10, 260, length)), material);
            torus.rotation.z = start;
            group.add(torus);
            const overlayMaterial = new THREE.ShaderMaterial({
                vertexShader: ringEngraveVertex,
                fragmentShader: ringEngraveFragment,
                uniforms: {
                    uSeed: { value: config.seed },
                    uOpacity: { value: config.pale ? 0.38 : 0.68 },
                    uTicks: { value: config.ticks },
                    uInner: { value: config.radius - config.tube - 0.48 },
                    uOuter: { value: config.radius + config.tube + 0.48 },
                },
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            });
            const overlay = new THREE.Mesh(trackGeometry(new THREE.RingGeometry(config.radius - config.tube - 0.48, config.radius + config.tube + 0.48, 260, 1, start, length)), overlayMaterial);
            overlay.position.z = config.tube + 0.06;
            overlay.rotation.z = 0;
            group.add(overlay);
            track(overlayMaterial);
        }
        const tickCounts = config.arcs.map(([, length]) => Math.round((config.ticks * length) / TAU));
        const tickCount = Math.max(1, tickCounts.reduce((sum, count) => sum + count, 0));
        const tickGeo = trackGeometry(new THREE.BoxGeometry(0.06, 0.72, 0.12));
        const ticks = new THREE.InstancedMesh(tickGeo, tickMaterial, tickCount);
        ticks.frustumCulled = false;
        const dummy = new THREE.Object3D();
        let index = 0;
        config.arcs.forEach(([start, length], arcIndex) => {
            const count = Math.max(1, tickCounts[arcIndex]);
            for (let i = 0; i < count; i++) {
                const angle = start + ((i + 0.5) / count) * length;
                const major = i % 5 === 0;
                dummy.position.set(Math.cos(angle) * config.radius, Math.sin(angle) * config.radius, config.tube + 0.09);
                dummy.rotation.set(0, 0, angle - Math.PI / 2);
                dummy.scale.set(1, major ? 1.8 : 1, 1);
                if (Math.random() < 0.028)
                    dummy.scale.setScalar(0.0001);
                dummy.updateMatrix();
                ticks.setMatrixAt(index++, dummy.matrix);
            }
        });
        ticks.count = index;
        group.add(ticks);
        clockGroup.add(group);
        rings.push({ group, speed: config.speed });
    }
    addRing({
        radius: 12.4,
        tube: 0.22,
        arcs: [[0.22, TAU * 0.97]],
        z: 0.5,
        speed: -0.035,
        ticks: 60,
        seed: 0.17,
        pale: true,
    });
    addRing({
        radius: 18.6,
        tube: 0.36,
        arcs: [[0.7, TAU * 0.58], [2.85, TAU * 0.26]],
        z: -1.1,
        speed: 0.022,
        ticks: 60,
        seed: 0.53,
        tiltX: 0.09,
        tiltY: -0.08,
    });
    addRing({
        radius: 25.7,
        tube: 0.20,
        arcs: [[2.35, TAU * 0.88]],
        z: -2.4,
        speed: -0.014,
        ticks: 72,
        seed: 0.81,
        pale: true,
        tiltX: -0.06,
        tiltY: 0.05,
    });
    addRing({
        radius: 32.6,
        tube: 0.09,
        arcs: [[0.35, TAU * 0.43], [3.4, TAU * 0.38]],
        z: -3.4,
        speed: 0.008,
        ticks: 96,
        seed: 0.34,
        pale: true,
        tiltX: 0.14,
        tiltY: -0.1,
    });
    // A second celestial axis, almost edge-on.
    const armillary = new THREE.Group();
    const armillaryMaterial = track(new THREE.MeshStandardMaterial({
        color: 0x4d3a22,
        metalness: 1,
        roughness: 0.3,
        envMapIntensity: 1.2,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
    }));
    const armA = new THREE.Mesh(trackGeometry(new THREE.TorusGeometry(29.5, 0.065, 6, 280)), armillaryMaterial);
    armA.rotation.x = 1.18;
    armA.rotation.y = 0.38;
    armillary.add(armA);
    const armB = new THREE.Mesh(trackGeometry(new THREE.TorusGeometry(22.8, 0.05, 6, 240)), armillaryMaterial);
    armB.rotation.y = Math.PI / 2 + 0.22;
    armB.rotation.x = 0.24;
    armillary.add(armB);
    clockGroup.add(armillary);
    // ---------- hands ----------
    const handMaterial = darkMetalMaterial;
    const longHand = new THREE.Group();
    longHand.position.z = 2.1;
    const longHandMesh = new THREE.Mesh(makeHandGeometry(21.5, 0.62), handMaterial);
    longHandMesh.geometry.computeVertexNormals();
    trackGeometry(longHandMesh.geometry);
    longHand.add(longHandMesh);
    const longEdge = new THREE.LineSegments(new THREE.EdgesGeometry(longHandMesh.geometry, 25), new THREE.LineBasicMaterial({
        color: 0xf0c987,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
    }));
    longHand.add(longEdge);
    const handFragments = [];
    const fragmentMaterial = track(new THREE.MeshStandardMaterial({
        color: 0x50391c,
        metalness: 1,
        roughness: 0.22,
        envMapIntensity: 1.8,
        emissive: 0x150a02,
    }));
    for (let i = 0; i < 7; i++) {
        const fragment = new THREE.Mesh(trackGeometry(new THREE.OctahedronGeometry(1, 0)), fragmentMaterial);
        const distance = 22.7 + i * 1.02 + Math.random() * 0.3;
        fragment.position.set((Math.random() - 0.5) * 0.3, distance, (Math.random() - 0.5) * 0.4);
        fragment.scale.set(0.09, 0.028, randomBetween(0.55, 1.7) * (1 - i * 0.07));
        fragment.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
        fragment.userData.spin = randomBetween(-0.2, 0.2);
        longHand.add(fragment);
        handFragments.push(fragment);
    }
    clockGroup.add(longHand);
    const shortHand = new THREE.Group();
    shortHand.position.z = 2.55;
    const shortHandMesh = new THREE.Mesh(makeHandGeometry(13.2, 0.78), handMaterial);
    trackGeometry(shortHandMesh.geometry);
    shortHand.add(shortHandMesh);
    const shortEdge = new THREE.LineSegments(new THREE.EdgesGeometry(shortHandMesh.geometry, 25), new THREE.LineBasicMaterial({
        color: 0xe8c68c,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
    }));
    shortHand.add(shortEdge);
    clockGroup.add(shortHand);
    // ---------- shards ----------
    const goldShardMaterial = track(new THREE.MeshStandardMaterial({
        color: 0x5a4220,
        metalness: 1,
        roughness: 0.17,
        envMapIntensity: 2.2,
        emissive: 0x140a02,
        flatShading: true,
    }));
    const iceShardMaterial = track(new THREE.MeshStandardMaterial({
        color: 0x2b435a,
        metalness: 0.92,
        roughness: 0.1,
        envMapIntensity: 2.1,
        emissive: 0x03101c,
        flatShading: true,
    }));
    const shardSystems = [];
    const shardTotal = coarsePointer ? 170 : 280;
    shardSystems.push(makeShardSystem(Math.round(shardTotal * 0.62), goldShardMaterial));
    shardSystems.push(makeShardSystem(Math.round(shardTotal * 0.38), iceShardMaterial));
    for (const system of shardSystems) {
        trackGeometry(system.mesh.geometry);
        system.mesh.renderOrder = 6;
        clockGroup.add(system.mesh);
        setShardMatrices(system, 0, 0);
    }
    // ---------- distant sentinels ----------
    const sentinelGroup = new THREE.Group();
    const sentinelMaterial = darkMetalMaterial;
    const sentinelGeometry = trackGeometry(new THREE.BoxGeometry(0.42, 1, 0.42));
    const sentinelCount = coarsePointer ? 5 : 7;
    const sentinels = new THREE.InstancedMesh(sentinelGeometry, sentinelMaterial, sentinelCount);
    sentinels.frustumCulled = false;
    const tipMaterial = track(new THREE.MeshStandardMaterial({
        color: 0x1a1207,
        metalness: 0.2,
        roughness: 0.5,
        emissive: 0xff9a4a,
        emissiveIntensity: 2.4,
    }));
    const sentinelTips = new THREE.InstancedMesh(trackGeometry(new THREE.BoxGeometry(0.075, 0.075, 0.075)), tipMaterial, sentinelCount);
    sentinelTips.frustumCulled = false;
    const sentinelDummy = new THREE.Object3D();
    for (let i = 0; i < sentinelCount; i++) {
        const angle = (i / sentinelCount) * TAU + 0.3;
        const radius = randomBetween(51, 59);
        const height = randomBetween(3.2, 7.4);
        const y = randomBetween(-1.2, 2.2);
        sentinelDummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius * 0.82);
        sentinelDummy.rotation.set(0.04, -angle, randomBetween(-0.05, 0.05));
        sentinelDummy.scale.set(randomBetween(0.5, 1.2), height, randomBetween(0.5, 1.2));
        sentinelDummy.updateMatrix();
        sentinels.setMatrixAt(i, sentinelDummy.matrix);
        sentinelDummy.position.y = y + height / 2;
        sentinelDummy.rotation.set(0, 0, 0);
        sentinelDummy.scale.setScalar(1);
        sentinelDummy.updateMatrix();
        sentinelTips.setMatrixAt(i, sentinelDummy.matrix);
    }
    sentinelGroup.add(sentinels);
    sentinelGroup.add(sentinelTips);
    clockGroup.add(sentinelGroup);
    // ---------- the sea of spent time ----------
    const seaMaterial = new THREE.ShaderMaterial({
        vertexShader: seaVertex,
        fragmentShader: seaFragment,
        uniforms: {
            uTime: { value: 0 },
            uPulse: { value: 0 },
            uPulseAmp: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
    });
    const sea = new THREE.Mesh(trackGeometry(new THREE.PlaneGeometry(540, 540)), seaMaterial);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -29;
    sea.renderOrder = 0;
    scene.add(sea);
    track(seaMaterial);
    // ---------- particles ----------
    const inflow = buildInflow(coarsePointer ? 3600 : 7200);
    const inflowMaterial = inflow.material;
    clockGroup.add(inflow);
    trackGeometry(inflow.geometry);
    track(inflowMaterial);
    const motes = buildMotes(coarsePointer ? 420 : 800);
    const moteMaterial = motes.material;
    scene.add(motes);
    trackGeometry(motes.geometry);
    track(moteMaterial);
    // ---------- post ----------
    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: coarsePointer ? 0 : 4,
    });
    const composer = new EffectComposer(renderer, renderTarget);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.72, 0.87);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    const finalPass = new ShaderPass(finalPassShader);
    composer.addPass(finalPass);
    // ---------- camera / interaction ----------
    const lookTarget = new THREE.Vector3();
    let baseRadius = 96;
    let targetTheta = 0;
    let theta = 0;
    let targetPhi = 1.33;
    let phi = 1.33;
    let targetRadius = 104;
    let radius = 104;
    let userZoomed = false;
    let intro = reducedMotion ? 1 : 0;
    let paused = reducedMotion;
    let collapseEnergy = 0;
    let flash = 0;
    let elapsed = 0;
    let pulseStarted = -10;
    let pulseAmp = 0;
    let dragging = false;
    let moved = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let tapStartedAt = 0;
    let activePointer = null;
    const touchPoints = new Map();
    let pinchDistance = 0;
    let disposed = false;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let qualityCap = coarsePointer ? 1.5 : 1.75;
    let lowFpsChecks = 0;
    function idealRadius() {
        const aspect = width / Math.max(height, 1);
        if (aspect < 0.7)
            return 132;
        if (aspect < 1.0)
            return 118;
        return 104;
    }
    function resize() {
        const rect = parent.getBoundingClientRect();
        width = Math.max(1, rect.width || window.innerWidth);
        height = Math.max(1, rect.height || window.innerHeight);
        dpr = Math.min(window.devicePixelRatio || 1, qualityCap);
        renderer.setPixelRatio(dpr);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        composer.setPixelRatio(dpr);
        composer.setSize(width, height);
        bloomPass.setSize(width * dpr, height * dpr);
        const pixelRatio = renderer.getPixelRatio();
        finalPass.uniforms.uResolution.value[0] = width * pixelRatio;
        finalPass.uniforms.uResolution.value[1] = height * pixelRatio;
        const aspect = width / height;
        lookTarget.set(aspect >= 1.05 ? -17.5 : 0, 5.5, 0);
        baseRadius = idealRadius();
        if (!userZoomed)
            targetRadius = baseRadius;
        if (intro >= 1)
            radius = targetRadius;
        const pixel = renderer.getPixelRatio();
        starMaterial.uniforms.uPixelRatio.value = pixel;
        inflowMaterial.uniforms.uPixelRatio.value = pixel;
        moteMaterial.uniforms.uPixelRatio.value = pixel;
    }
    function collapse() {
        if (paused)
            paused = false;
        collapseEnergy = Math.min(1.35, collapseEnergy + 1.0);
        flash = 1;
        pulseStarted = elapsed;
        pulseAmp = Math.min(1.0, pulseAmp + 0.9);
        targetRadius = Math.max(58, targetRadius * 0.988);
    }
    function setPaused(value) {
        paused = value;
    }
    function resetView() {
        targetTheta = 0;
        targetPhi = 1.33;
        targetRadius = baseRadius;
        userZoomed = false;
    }
    const onPointerDown = (event) => {
        if (event.button !== 0 && event.pointerType === "mouse")
            return;
        touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPoints.size === 2) {
            const points = [...touchPoints.values()];
            pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            dragging = true;
            moved = true;
            canvas.setPointerCapture?.(event.pointerId);
            return;
        }
        activePointer = event.pointerId;
        dragging = true;
        moved = false;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        tapStartedAt = performance.now();
        parent.classList.add("is-dragging");
        canvas.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event) => {
        if (!touchPoints.has(event.pointerId))
            return;
        touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPoints.size === 2) {
            const points = [...touchPoints.values()];
            const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            if (pinchDistance > 0) {
                targetRadius *= pinchDistance / Math.max(distance, 1);
                targetRadius = THREE.MathUtils.clamp(targetRadius, 54, 185);
                userZoomed = true;
            }
            pinchDistance = distance;
            return;
        }
        if (!dragging || event.pointerId !== activePointer)
            return;
        const dx = event.clientX - lastPointerX;
        const dy = event.clientY - lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 1)
            moved = true;
        targetTheta -= dx * 0.0042;
        targetPhi = THREE.MathUtils.clamp(targetPhi + dy * 0.0028, 0.40, 1.50);
    };
    const releasePointer = (event) => {
        touchPoints.delete(event.pointerId);
        if (touchPoints.size === 1) {
            const remaining = [...touchPoints.entries()][0];
            activePointer = remaining[0];
            lastPointerX = remaining[1].x;
            lastPointerY = remaining[1].y;
            pinchDistance = 0;
            return;
        }
        if (touchPoints.size === 0) {
            const wasClick = dragging && !moved
                && (event.pointerType !== "touch" || performance.now() - tapStartedAt < 400);
            dragging = false;
            activePointer = null;
            pinchDistance = 0;
            parent.classList.remove("is-dragging");
            if (wasClick)
                collapse();
        }
    };
    const onWheel = (event) => {
        event.preventDefault();
        targetRadius *= Math.exp(event.deltaY * 0.0009);
        targetRadius = THREE.MathUtils.clamp(targetRadius, 54, 185);
        userZoomed = true;
    };
    const onKeyDown = (event) => {
        const target = event.target;
        if (target?.closest("button, a, input, textarea, select"))
            return;
        if (event.key === "ArrowLeft") {
            targetTheta += 0.14;
        }
        else if (event.key === "ArrowRight") {
            targetTheta -= 0.14;
        }
        else if (event.key === "ArrowUp") {
            targetPhi = THREE.MathUtils.clamp(targetPhi - 0.07, 0.40, 1.50);
        }
        else if (event.key === "ArrowDown") {
            targetPhi = THREE.MathUtils.clamp(targetPhi + 0.07, 0.40, 1.50);
        }
        else if (event.key === "+" || event.key === "=") {
            targetRadius = THREE.MathUtils.clamp(targetRadius * 0.9, 54, 185);
            userZoomed = true;
        }
        else if (event.key === "-" || event.key === "_") {
            targetRadius = THREE.MathUtils.clamp(targetRadius * 1.1, 54, 185);
            userZoomed = true;
        }
        else {
            return;
        }
        event.preventDefault();
    };
    const onContextLost = (event) => {
        event.preventDefault();
        paused = true;
        options.onError?.("图形上下文已丢失。刷新页面可以重新进入视界。");
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("webglcontextlost", onContextLost);
    window.addEventListener("keydown", onKeyDown);
    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(parent);
    resize();
    // ---------- loop ----------
    let raf = 0;
    let lastTime = performance.now();
    let telemetryClock = 0;
    let fpsTime = 0;
    let fpsFrames = 0;
    let fps = 60;
    let readyCalled = false;
    const tick = (now) => {
        if (disposed)
            return;
        raf = requestAnimationFrame(tick);
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        if (document.hidden)
            return;
        if (!paused)
            elapsed += dt;
        intro = Math.min(1, intro + dt / 4.6);
        const introEase = 1 - Math.pow(1 - intro, 3);
        collapseEnergy *= Math.exp(-dt * 0.86);
        flash *= Math.exp(-dt * 2.8);
        pulseAmp *= Math.exp(-dt * 0.62);
        theta += (targetTheta - theta) * (1 - Math.exp(-dt * 6.5));
        phi += (targetPhi - phi) * (1 - Math.exp(-dt * 6.5));
        radius += (targetRadius - radius) * (1 - Math.exp(-dt * 4.2));
        const sway = reducedMotion ? 0 : 1;
        const viewTheta = theta
            + Math.sin(elapsed * 0.071) * 0.12 * sway
            + (1 - introEase) * -0.34;
        const viewPhi = THREE.MathUtils.clamp(phi + Math.sin(elapsed * 0.052 + 1.4) * 0.011 * sway + (1 - introEase) * 0.12, 0.36, 1.52);
        const viewRadius = radius + (1 - introEase) * baseRadius * 0.52;
        const shake = collapseEnergy * 0.35;
        const shakeX = Math.sin(elapsed * 63.0 + 2.1) * shake;
        const shakeY = Math.cos(elapsed * 71.0 + 0.7) * shake * 0.6;
        camera.position.set(lookTarget.x + viewRadius * Math.sin(viewPhi) * Math.sin(viewTheta) + shakeX, lookTarget.y + viewRadius * Math.cos(viewPhi) + shakeY, lookTarget.z + viewRadius * Math.sin(viewPhi) * Math.cos(viewTheta));
        camera.lookAt(lookTarget);
        sky.position.copy(camera.position);
        // billboards must face the camera
        corona.quaternion.copy(camera.quaternion);
        halo.quaternion.copy(camera.quaternion);
        const time = elapsed;
        const energy = collapseEnergy;
        skyMaterial.uniforms.uTime.value = time;
        starMaterial.uniforms.uTime.value = time;
        starMaterial.uniforms.uPixelRatio.value = dpr;
        coronaMaterial.uniforms.uTime.value = time;
        coronaMaterial.uniforms.uIntensity.value = 0.9 + energy * 0.7;
        haloMaterial.uniforms.uTime.value = time;
        haloMaterial.uniforms.uIntensity.value = 0.52 + energy * 0.4;
        vortexMaterial.uniforms.uTime.value = time;
        vortexMaterial.uniforms.uIntensity.value = 0.82 + energy * 0.75;
        vortexEchoMaterial.uniforms.uTime.value = time;
        vortexEchoMaterial.uniforms.uIntensity.value = 0.12 + energy * 0.22;
        seaMaterial.uniforms.uTime.value = time;
        seaMaterial.uniforms.uPulse.value = THREE.MathUtils.clamp((time - pulseStarted) / 2.6, 0, 1);
        seaMaterial.uniforms.uPulseAmp.value = pulseAmp;
        inflowMaterial.uniforms.uTime.value = time;
        inflowMaterial.uniforms.uPixelRatio.value = dpr;
        inflowMaterial.uniforms.uCollapse.value = energy;
        moteMaterial.uniforms.uTime.value = time;
        moteMaterial.uniforms.uPixelRatio.value = dpr;
        finalPass.uniforms.uTime.value = time;
        finalPass.uniforms.uFlash.value = flash;
        bloomPass.strength = 0.46 + energy * 0.58;
        if (!paused) {
            const speed = 1 + energy * 6.5;
            for (const ring of rings)
                ring.group.rotation.z += ring.speed * speed * dt;
            longHand.rotation.z = -0.95 - time * 0.028 * speed;
            shortHand.rotation.z = 0.82 + time * 0.0105 * speed;
            for (const fragment of handFragments) {
                fragment.rotation.z += fragment.userData.spin * dt * speed;
                fragment.rotation.x += 0.12 * dt * speed;
            }
            for (const system of shardSystems)
                setShardMatrices(system, time, energy);
            sentinelGroup.rotation.y = time * 0.005;
            armillary.rotation.y = time * 0.008;
            armillary.rotation.z = Math.sin(time * 0.04) * 0.05;
            clockFace.rotation.z = Math.sin(time * 0.011) * 0.015;
            vortex.rotation.z = 0.1 + time * 0.006;
            vortexEcho.rotation.z = -time * 0.004;
        }
        else {
            for (const system of shardSystems)
                setShardMatrices(system, time, 0);
        }
        composer.render();
        fpsTime += dt;
        fpsFrames += 1;
        if (fpsTime >= 0.5) {
            fps = fpsFrames / fpsTime;
            fpsTime = 0;
            fpsFrames = 0;
        }
        telemetryClock += dt;
        if (elapsed > 5 && !paused && fps < 42) {
            lowFpsChecks += dt;
        }
        else {
            lowFpsChecks = 0;
        }
        if (lowFpsChecks > 2.4) {
            lowFpsChecks = 0;
            if (qualityCap > 1.2) {
                qualityCap = 1.2;
                resize();
            }
            else if (qualityCap > 1.0) {
                qualityCap = 1.0;
                resize();
            }
        }
        if (telemetryClock >= 0.2) {
            telemetryClock = 0;
            options.onTelemetry?.({
                dilation: 1 + energy * 5.5,
                distance: camera.position.distanceTo(lookTarget),
                energy,
                paused,
                fps,
            });
        }
        if (!readyCalled) {
            readyCalled = true;
            options.onReady?.();
        }
    };
    raf = requestAnimationFrame(tick);
    function dispose() {
        disposed = true;
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", releasePointer);
        canvas.removeEventListener("pointercancel", releasePointer);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        window.removeEventListener("keydown", onKeyDown);
        for (const material of materials)
            material.dispose();
        for (const geometry of geometries)
            geometry.dispose();
        for (const item of disposables)
            item.dispose();
        composer.dispose();
        renderer.dispose();
    }
    return { collapse, setPaused, resetView, dispose };
}
`,
  },
  {
    path: 'shaders.js',
    content: `// GLSL for 《时间的尽头》. Everything is procedural: no textures are downloaded.
export const NOISE_2D = /* glsl */ \`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.03 + 17.31;
    a *= 0.5;
  }
  return v;
}
\`;
export const NOISE_3D = /* glsl */ \`
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise3(p);
    p = p * 2.04 + vec3(11.7, 3.1, 7.9);
    a *= 0.5;
  }
  return v;
}
\`;
export const skyVertex = /* glsl */ \`
varying vec3 vDir;

void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
export const skyFragment = /* glsl */ \`
\${NOISE_3D}

varying vec3 vDir;
uniform float uTime;

void main() {
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  float az = atan(d.z, d.x) / 6.2831853 + 0.5;

  float nebula = fbm3(d * 3.1 + vec3(uTime * 0.004, 0.0, 0.0));
  float detail = fbm3(d * 7.4 + vec3(0.0, uTime * 0.003, 2.7));
  float band = smoothstep(0.42, 0.82, nebula * 0.82 + detail * 0.32);

  vec3 col = vec3(0.0018, 0.0036, 0.0088);
  col += vec3(0.0055, 0.024, 0.040) * band * (0.30 + 0.70 * el);
  col += vec3(0.012, 0.0035, 0.012) * pow(max(0.0, detail), 2.4) * 0.30;
  col += vec3(0.004, 0.018, 0.042) * smoothstep(0.52, 1.0, el) * band * 0.68;

  float horizon = exp(-pow((d.y + 0.02) * 4.6, 2.0));
  col += vec3(0.034, 0.015, 0.007) * horizon * 0.62;

  float auroraMask = smoothstep(0.56, 0.79, el) * (1.0 - smoothstep(0.955, 1.0, el));
  float ribbon = sin(az * 14.0 + fbm3(d * 4.6 + vec3(0.0, uTime * 0.012, 0.0)) * 12.0 + uTime * 0.03);
  float ribbon2 = sin(az * 23.0 - fbm3(d * 8.1 + 4.0) * 9.0 - uTime * 0.02);
  col += vec3(0.007, 0.045, 0.056) * pow(max(0.0, ribbon), 3.0) * auroraMask * 0.42;
  col += vec3(0.042, 0.017, 0.006) * pow(max(0.0, ribbon2), 4.0) * auroraMask * 0.20;

  col *= mix(0.18, 1.0, smoothstep(0.16, 0.54, el));
  col += (hash13(vec3(gl_FragCoord.xy, floor(uTime * 24.0))) - 0.5) * 0.0032;
  gl_FragColor = vec4(col, 1.0);
}
\`;
export const starVertex = /* glsl */ \`
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;

uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  float twinkle = 0.68 + 0.32 * sin(uTime * (0.35 + aPhase * 0.9) + aPhase * 41.0);
  vAlpha = twinkle;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio * (1.0 + twinkle * 0.25);
  gl_Position = projectionMatrix * mv;
}
\`;
export const starFragment = /* glsl */ \`
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.02, d);
  float halo = smoothstep(0.5, 0.24, d) * 0.22;
  float alpha = (core * 0.85 + halo) * vAlpha;
  gl_FragColor = vec4(vColor, alpha);
}
\`;
export const coronaVertex = /* glsl */ \`
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
export const coronaFragment = /* glsl */ \`
\${NOISE_2D}

varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);

  float ring = exp(-pow((r - 0.5) * 72.0, 2.0));
  float hairline = exp(-pow((r - 0.518) * 168.0, 2.0)) * 0.42;
  float rays = 0.38 + 0.62 * pow(
    max(0.0, 0.5 + 0.5 * sin(a * 46.0 + fbm(vec2(a * 7.0, r * 9.0 - uTime * 0.03)) * 9.0)),
    3.2
  );
  float haze = exp(-max(r - 0.5, 0.0) * 9.5) * (1.0 - smoothstep(0.5, 1.0, r)) * 0.24;
  float doppler = 0.72 + 0.28 * cos(a + 2.1);

  vec3 ember = vec3(1.0, 0.37, 0.09);
  vec3 bone = vec3(1.0, 0.84, 0.58);
  vec3 col = mix(ember, bone, clamp(ring * 0.95 + hairline * 0.5, 0.0, 1.0));

  float alpha = (ring * 0.82 + hairline * 0.7 + haze) * rays * doppler * uIntensity;
  alpha *= smoothstep(0.0, 0.02, r);
  gl_FragColor = vec4(col, alpha);
}
\`;
export const haloVertex = coronaVertex;
export const haloFragment = /* glsl */ \`
\${NOISE_2D}

varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float n = fbm(vec2(a * 5.0, r * 4.0 - uTime * 0.01));

  float aura = exp(-pow(r * 2.15, 1.55)) * 0.17;
  float outerRing = exp(-pow((r - 0.68) * 20.0, 2.0)) * 0.065;
  float fan = pow(max(0.0, 0.5 + 0.5 * sin(a * 18.0 + n * 8.0 + uTime * 0.02)), 5.0) * exp(-r * 1.6) * 0.06;
  float alpha = (aura + outerRing + fan) * uIntensity * smoothstep(0.0, 0.05, r);

  vec3 col = mix(vec3(0.35, 0.60, 0.95), vec3(1.0, 0.58, 0.24), 0.30 + 0.50 * n);
  gl_FragColor = vec4(col, alpha);
}
\`;
export const vortexVertex = /* glsl */ \`
varying vec2 vP;

void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
export const vortexFragment = /* glsl */ \`
\${NOISE_2D}

varying vec2 vP;
uniform float uTime;
uniform float uIntensity;
uniform float uInner;
uniform float uOuter;

void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float t = uTime * 0.115;

  float n = fbm(vec2(a * 2.2 + r * 0.20 - t * 2.0, r * 0.42 + t * 0.55));
  float spiral = 0.5 + 0.5 * sin(a * 3.0 + r * 0.62 - t * 4.1 + n * 5.5);
  float arms = pow(max(0.0, spiral), 5.0);
  float fine = pow(max(0.0, 0.5 + 0.5 * sin(a * 13.0 + r * 1.15 - t * 6.0 + n * 8.0)), 3.0) * 0.35;
  float mask = smoothstep(uInner, uInner + 2.0, r) * (1.0 - smoothstep(uOuter - 9.0, uOuter, r));
  float inner = exp(-pow((r - uInner - 0.25) / 0.85, 2.0));

  vec3 ember = vec3(1.0, 0.24, 0.045);
  vec3 gold = vec3(1.0, 0.66, 0.30);
  vec3 ice = vec3(0.22, 0.52, 0.92);
  vec3 col = mix(ember, gold, arms * 0.62 + inner * 0.32);
  col += ice * pow(max(0.0, 1.0 - smoothstep(uInner + 2.0, uOuter, r)), 2.2) * 0.13;

  float alpha = (arms * 0.34 + fine * 0.24 + n * 0.08 + inner * 0.72) * mask * uIntensity * 0.44;
  gl_FragColor = vec4(col, alpha);
}
\`;
export const seaVertex = /* glsl */ \`
varying vec2 vP;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vP = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
\`;
export const seaFragment = /* glsl */ \`
\${NOISE_2D}

varying vec2 vP;
uniform float uTime;
uniform float uPulse;
uniform float uPulseAmp;

void main() {
  float r = length(vP);
  float t = uTime;
  float n = fbm(vP * 0.020 + vec2(t * 0.004, -t * 0.003));
  float ripple = sin(r * 0.46 - t * 0.30 + n * 5.2);
  float line = smoothstep(0.88, 1.0, ripple) * exp(-r * 0.016) * 0.052;
  float glow = exp(-r * 0.040) * 0.085;

  float pulseR = max(uPulse, 0.0001) * 110.0;
  float pulse = exp(-pow((r - pulseR) / (3.0 + uPulse * 2.5), 2.0)) * uPulseAmp;

  float sparkle = step(0.9978, hash12(floor(vP * 1.8)))
    * (0.35 + 0.65 * sin(t * 1.6 + hash12(floor(vP * 1.8)) * 30.0));

  vec3 col = vec3(0.0032, 0.0068, 0.0135);
  col += vec3(0.050, 0.078, 0.115) * n * 0.30;
  col += vec3(0.62, 0.31, 0.11) * (glow + line) * 0.52;
  col += vec3(1.0, 0.56, 0.24) * pulse * 0.68;
  col += vec3(0.50, 0.68, 0.95) * sparkle * 0.34;

  float alpha = 1.0 - smoothstep(120.0, 220.0, r);
  gl_FragColor = vec4(col, alpha * 0.72);
}
\`;
export const ringEngraveVertex = /* glsl */ \`
varying vec2 vP;

void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`;
export const ringEngraveFragment = /* glsl */ \`
\${NOISE_2D}

varying vec2 vP;
uniform float uSeed;
uniform float uOpacity;
uniform float uTicks;
uniform float uInner;
uniform float uOuter;

void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float u = (r - uInner) / (uOuter - uInner);

  if (u < 0.0 || u > 1.0) discard;

  float seg = (a / 6.2831853 + 0.5) * uTicks + uSeed;
  float f = fract(seg);
  float idx = floor(seg);
  float tickMask = 1.0 - smoothstep(0.018, 0.085, min(f, 1.0 - f));

  float m = mod(idx, 5.0);
  float major = 1.0 - step(0.5, min(m, 5.0 - m));
  float len = mix(0.30, 0.66, major);
  float ticks = tickMask * smoothstep(1.0 - len - 0.015, 1.0 - len, u) * (1.0 - smoothstep(0.993, 1.0, u));

  float groove = 0.0;
  groove += 1.0 - smoothstep(0.0, 0.018, abs(u - 0.085));
  groove += 1.0 - smoothstep(0.0, 0.014, abs(u - 0.50));
  groove += 1.0 - smoothstep(0.0, 0.014, abs(u - 0.86));

  float damage = step(0.055, hash12(vec2(idx, uSeed * 17.0)));
  float wear = 0.55 + 0.45 * vnoise(vec2(a * 18.0, u * 5.0 + uSeed * 9.0));

  vec3 col = mix(vec3(0.38, 0.55, 0.82), vec3(1.0, 0.80, 0.52), ticks);
  float alpha = (ticks * 0.92 + groove * 0.20) * damage * wear * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
\`;
export const inflowVertex = /* glsl */ \`
attribute float aSeed;
attribute float aAngle;
attribute float aRadius;
attribute float aZ;
attribute float aSpeed;
attribute float aSize;
attribute float aTint;

uniform float uTime;
uniform float uPixelRatio;
uniform float uCollapse;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float motion = uTime * (0.024 + aSpeed * 0.042) * (1.0 + uCollapse * 4.5);
  float life = fract(aSeed + motion);

  float radius = mix(aRadius, 7.35, pow(life, 1.55));
  float angle = aAngle + (1.0 - life) * (0.45 + aTint * 1.15) + uTime * 0.012;
  float z = aZ * (1.0 - life * 0.9) + sin(uTime * 0.22 + aSeed * 31.0) * 0.22;

  vec3 p = vec3(cos(angle) * radius, sin(angle) * radius, z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  gl_PointSize = aSize * uPixelRatio * (92.0 / max(-mv.z, 1.0));

  float warm = pow(1.0 - life, 2.2);
  vColor = mix(vec3(0.45, 0.72, 1.0), vec3(1.0, 0.45, 0.13), warm);
  vColor += vec3(1.0, 0.86, 0.68) * pow(max(0.0, 1.0 - smoothstep(0.0, 0.18, life)), 2.0) * 0.65;
  vAlpha = smoothstep(0.0, 0.09, life) * (1.0 - smoothstep(0.84, 1.0, life));
  vAlpha *= 0.30 + aTint * 0.28;
  vAlpha *= 1.0 + uCollapse * 0.35;
}
\`;
export const inflowFragment = /* glsl */ \`
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.02, d);
  float glow = smoothstep(0.5, 0.16, d) * 0.32;
  float alpha = (core + glow) * vAlpha;
  gl_FragColor = vec4(vColor * 1.22, alpha * 0.70);
}
\`;
export const moteVertex = /* glsl */ \`
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;

uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.055 + aPhase * 12.0) * 1.8;
  p.y += cos(uTime * 0.043 + aPhase * 9.0) * 1.4;
  p.z += sin(uTime * 0.037 + aPhase * 17.0) * 1.2;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (72.0 / max(-mv.z, 1.0));

  vColor = aColor;
  vAlpha = 0.30 + 0.70 * pow(0.5 + 0.5 * sin(uTime * 0.32 + aPhase * 20.0), 2.0);
}
\`;
export const moteFragment = /* glsl */ \`
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.08, d) * vAlpha;
  gl_FragColor = vec4(vColor, a * 0.52);
}
\`;
export const finalPassShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: [1, 1] },
        uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ \`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
\`,
    fragmentShader: /* glsl */ \`
\${NOISE_2D}

uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uFlash;
varying vec2 vUv;

void main() {
  vec2 fromCenter = vUv - 0.5;
  float d = length(fromCenter);
  float ca = 0.0016 * d * d;

  vec3 col;
  col.r = texture2D(tDiffuse, vUv + fromCenter * ca).r;
  col.g = texture2D(tDiffuse, vUv).g;
  col.b = texture2D(tDiffuse, vUv - fromCenter * ca).b;

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.86, 0.95, 1.14), smoothstep(0.30, 0.0, luma) * 0.42);
  col = mix(col, col * vec3(1.06, 1.01, 0.94), smoothstep(0.55, 1.0, luma) * 0.25);

  float grain = hash12(vUv * uResolution + vec2(fract(uTime) * 311.7));
  col += (grain - 0.5) * 0.026;
  col += uFlash * vec3(1.0, 0.76, 0.48) * 0.10;

  float vig = smoothstep(0.92, 0.38, d);
  col *= mix(0.50, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
\`,
};
`,
  },
];

/**
 * 首次启动时把《时间的尽头》从构建期静态页迁成内置实验：
 * 文件写进 DATA_DIR/labs/end-of-time/，元数据写进 labs 表。
 *
 * - 普通内存数据库（单元测试）默认跳过，避免污染测试数据。
 * - kv 标记已存在就直接返回，所以用户删掉这个实验后不会在下次重启时复活。
 * - 表里已经有同 slug 的记录时只补标记，不写入文件。
 *
 * @returns 本次是否真正写入了文件和记录。
 */
export function seedBuiltinLabs(
  db: DB,
  dataDir: string,
  nowMs = Date.now(),
  opts?: { force?: boolean },
): boolean {
  if (!opts?.force && dataDir === ':memory:') return false;
  if (kvGet(db, LABS_SEEDED_KEY) !== undefined) return false;

  const existing = db.prepare('SELECT 1 FROM labs WHERE slug = ?').get(END_OF_TIME_SLUG);
  if (existing !== undefined) {
    kvSet(db, LABS_SEEDED_KEY, '1');
    return false;
  }

  for (const file of END_OF_TIME_FILES) {
    writeFile(dataDir, END_OF_TIME_SLUG, file.path, file.content);
  }

  const t = new Date(nowMs).toISOString();
  db.prepare(
    `INSERT INTO labs (slug, title, intro, stack, status, cover, entry, featured, draft, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    END_OF_TIME_SLUG,
    '时间的尽头',
    '一座停在时间尽头的天文钟，一片正在熄灭的星海。拖动、靠近，或让时间坍缩。',
    'THREE.JS · 交互 3D',
    'WebGL · 已完成',
    '/lab/end-of-time-poster.webp',
    'index.html',
    1,
    0,
    10,
    t,
    t,
  );

  kvSet(db, LABS_SEEDED_KEY, '1');
  return true;
}
