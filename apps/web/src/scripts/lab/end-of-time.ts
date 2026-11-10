import { createEndOfTime, type EndOfTimeHandle } from "./end-of-time/engine";

function boot(): void {
  const root = document.getElementById("eot");
  const canvas = document.getElementById("eot-canvas") as HTMLCanvasElement | null;
  if (!root || !canvas) return;

  const loading = document.getElementById("eot-loading");
  const fallback = document.getElementById("eot-fallback");
  const fallbackText = document.getElementById("eot-fallback-text");
  const pauseButton = document.getElementById("eot-pause") as HTMLButtonElement | null;
  const collapseButton = document.getElementById("eot-collapse") as HTMLButtonElement | null;
  const resetButton = document.getElementById("eot-reset") as HTMLButtonElement | null;
  const dilationNode = document.getElementById("eot-dilation");
  const distanceNode = document.getElementById("eot-distance");
  const stateNode = document.getElementById("eot-state");
  const fpsNode = document.getElementById("eot-fps");
  const hint = document.getElementById("eot-hint");
  const liveLabel = document.getElementById("eot-live-label");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let handle: EndOfTimeHandle | null = null;
  let paused = reducedMotion;
  let closeView = false;

  const showFallback = (message: string): void => {
    root.classList.add("is-broken");
    root.classList.remove("is-loading");
    if (fallbackText) fallbackText.textContent = message;
    if (fallback) fallback.hidden = false;
  };

  const syncPause = (): void => {
    if (!pauseButton) return;
    pauseButton.setAttribute("aria-pressed", paused ? "true" : "false");
    pauseButton.setAttribute("aria-label", paused ? "继续时间" : "暂停时间");
    pauseButton.title = paused ? "继续时间（P）" : "暂停时间（P）";
    if (liveLabel) liveLabel.textContent = paused ? "PAUSED" : "LIVE";
    root.classList.toggle("is-paused", paused);
  };

  const setPaused = (value: boolean): void => {
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
        if (reducedMotion) setPaused(true);
      },
      onTelemetry: (telemetry) => {
        paused = telemetry.paused;
        syncPause();
        if (dilationNode) dilationNode.textContent = `×${telemetry.dilation.toFixed(2)}`;
        if (distanceNode) distanceNode.textContent = telemetry.distance.toFixed(1);
        if (fpsNode) fpsNode.textContent = `${Math.round(telemetry.fps)}`;
        if (stateNode) {
          const state = telemetry.paused ? "静默" : telemetry.energy > 0.08 ? "坍缩" : "稳定";
          if (stateNode.textContent !== state) stateNode.textContent = state;
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
  } catch (error) {
    console.error(error);
    showFallback("这台设备没有可用的 WebGL2 上下文。换一个支持硬件加速的浏览器再试。");
    return;
  }

  syncPause();

  const collapse = (): void => {
    if (!handle) return;
    handle.collapse();
    paused = false;
    syncPause();
    root.classList.remove("is-collapsing");
    void root.offsetWidth;
    root.classList.add("is-collapsing");
    window.setTimeout(() => root.classList.remove("is-collapsing"), 900);
    if (navigator.vibrate) navigator.vibrate(18);
  };

  collapseButton?.addEventListener("click", collapse);
  pauseButton?.addEventListener("click", () => setPaused(!paused));
  resetButton?.addEventListener("click", () => handle?.resetView());

  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select")) return;
    if (event.code === "Space") {
      event.preventDefault();
      collapse();
    } else if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      setPaused(!paused);
    } else if (event.key.toLowerCase() === "r") {
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
} else {
  boot();
}
