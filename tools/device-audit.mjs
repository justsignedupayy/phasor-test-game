/**
 * device-audit.mjs — cross-device framing & UI audit (READ-ONLY dev tooling).
 * Boots the PROD bundle (serve /dist first) at every viewport in the matrix,
 * captures idle + upgrade-menu screenshots into audit-screens/, measures the
 * HUD's DOM boxes for overlap/clipping, and computes the analytic camera
 * framing (visible world units, pits on screen, playable-area share) from the
 * same math as SceneManager.#onResize. Emits audit-screens/measurements.json.
 *
 * Usage:  npx vite preview --config vite/config.prod.mjs --port 8081 &
 *         node tools/device-audit.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE_URL = process.env.AUDIT_URL ?? 'http://localhost:8081/';
const OUT_DIR = 'audit-screens';

// ---------------------------------------------------------------- matrix ---
const phones = [
  { w: 360, h: 800, dpr: 3, name: 'android-small' },
  { w: 375, h: 667, dpr: 2, name: 'iphone-se' },
  { w: 393, h: 852, dpr: 3, name: 'iphone-15' },
  { w: 430, h: 932, dpr: 3, name: 'phone-large' },
];
const tablets = [
  { w: 768, h: 1024, dpr: 2, name: 'ipad-mini' },
  { w: 820, h: 1180, dpr: 2, name: 'ipad-10-9' },
  { w: 800, h: 1280, dpr: 1.5, name: 'android-tablet' }, // landscape-first: 1280×800
];
const desktops = [
  { w: 1280, h: 800, dpr: 1, name: 'laptop-1280' },
  { w: 1440, h: 900, dpr: 2, name: 'macbook-1440' },
  { w: 1920, h: 1080, dpr: 1, name: 'desktop-1080p' },
  { w: 2560, h: 1440, dpr: 1, name: 'desktop-1440p' },
  { w: 3440, h: 1440, dpr: 1, name: 'ultrawide' },
];

const matrix = [];
for (const d of [...phones, ...tablets]) {
  matrix.push({ ...d, w: Math.min(d.w, d.h), h: Math.max(d.w, d.h), orient: 'portrait', touch: true });
  matrix.push({ ...d, w: Math.max(d.w, d.h), h: Math.min(d.w, d.h), orient: 'landscape', touch: true });
}
for (const d of desktops) matrix.push({ ...d, orient: 'landscape', touch: false });

// ------------------------------------------------- analytic camera math ---
// Mirrors SceneManager.#onResize + the isometric basis. Camera sits at
// (d,d,d) looking at the target: screen-right on the ground is (x̂−ẑ)/√2
// (1 ground unit → 1 camera unit), screen-up on the ground is −(x̂+ẑ)/√2
// foreshortened by 1/√3 (1 ground unit → 1/√3 camera units).
const VIEW = 25; // settings.camera.viewSize
const PORTRAIT_MAX_STRETCH = 1.6; // settings.camera.portraitMaxStretch
const MAX_ASPECT_GROW = 2.0; // settings.camera.maxAspectGrow
const PORTRAIT_Z_BIAS = 2; // settings.camera.portraitZBias
const HALF_X = 48, HALF_Z = 10; // settings.world (building strip)
const PITS = [-27, -13.5, 0, 13.5, 27].map((x) => ({ x, z: 4 })); // settings.pit.positions
const SPAWN = { x: -24.5, z: 0 }; // GameState player start = idle camera target
const SQRT2 = Math.SQRT2, SQRT6 = Math.sqrt(6);

// Mirrors SceneManager.#onResize INCLUDING the post-audit aspect clamps.
function frustum(w, h) {
  const aspect = w / h;
  const half = VIEW / 2;
  if (aspect >= 1) {
    const grow = Math.min(aspect, MAX_ASPECT_GROW);
    const hw = half * grow;
    return { hw, hh: hw / aspect, aspect };
  }
  const stretch = Math.min(1 / aspect, PORTRAIT_MAX_STRETCH);
  const hh = half * stretch;
  return { hw: hh * aspect, hh, aspect };
}

/** screen coords (camera units) of a ground point relative to the camera target */
function project(dx, dz) {
  return { u: (dx - dz) / SQRT2, v: -(dx + dz) / SQRT6 };
}

function analyze(w, h) {
  const { hw, hh, aspect } = frustum(w, h);
  // Idle camera target: spawn, biased into the room in portrait (follow()'s z-bias).
  const CAM = { x: SPAWN.x, z: SPAWN.z - (aspect < 1 ? PORTRAIT_Z_BIAS : 0) };
  // Max pits on screen at once with the camera riding the row (u-spacing
  // 13.5/√2, v-spacing 13.5/√6 — the row reads diagonally, both axes bind).
  const uCap = Math.floor((2 * hw) / (13.5 / SQRT2)) + 1;
  const vCap = Math.floor((2 * hh) / (13.5 / SQRT6)) + 1;
  const pitsVisible = Math.min(5, uCap, vCap);
  // Playable share: sample the visible ground parallelogram centered on the
  // spawn (the idle screenshot's camera target); interior = building strip.
  const N = 120;
  let inside = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const u = -hw + (2 * hw * (i + 0.5)) / N;
      const v = -hh + (2 * hh * (j + 0.5)) / N;
      const s = v * Math.sqrt(3); // ground distance along screen-up
      const x = CAM.x + u / SQRT2 - s / SQRT2;
      const z = CAM.z - u / SQRT2 - s / SQRT2;
      if (Math.abs(x) <= HALF_X && Math.abs(z) <= HALF_Z) inside++;
    }
  }
  // Pits inside the frustum from the actual idle camera target (spawn).
  const pitsFromSpawn = PITS.filter((p) => {
    const { u, v } = project(p.x - CAM.x, p.z - CAM.z);
    return Math.abs(u) <= hw && Math.abs(v) <= hh;
  }).length;
  return {
    aspect: +aspect.toFixed(3),
    worldW: +(2 * hw).toFixed(1), // camera-units horizontally = ground units along the screen-x diagonal
    worldH: +(2 * hh).toFixed(1),
    groundDepth: +(2 * hh * Math.sqrt(3)).toFixed(1), // ground units along screen-up (foreshortening undone)
    pitsVisible,
    pitsBindingAxis: uCap <= vCap ? 'width' : 'height',
    pitsFromSpawn,
    playablePct: +((inside / (N * N)) * 100).toFixed(1),
  };
}

// ----------------------------------------------------------- DOM probes ---
async function measureHud(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const byText = (txt) =>
      [...document.querySelectorAll('button, span, div')].find(
        (e) => e.childElementCount <= 3 && e.textContent.trim() === txt && e.getBoundingClientRect().width > 0
      )?.closest('button');
    const els = {
      upgradesTab: byText('Upgrades'),
      settingsTab: byText('Settings'),
      pauseBtn: document.querySelector('button[title="Pause"]'),
      cash: [...document.querySelectorAll('div')].find(
        (e) => e.style.position === 'fixed' && e.style.left === '50%' && e.style.zIndex === '15'
      ),
      canvas: document.querySelector('canvas'),
    };
    const boxes = Object.fromEntries(Object.entries(els).map(([k, el]) => [k, box(el)]));
    // pairwise horizontal gaps across the top HUD row + edge clearances
    const gap = (a, b) => (a && b ? +(b.x - (a.x + a.w)).toFixed(1) : null);
    // TRUE rectangle intersection (the horizontal `gaps` alone can't tell a
    // stacked layout from a hidden one — post-fix the cash row may sit BELOW
    // the tabs on purpose).
    const intersects = (a, b) =>
      !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    return {
      viewport: { vw, vh },
      boxes,
      gaps: {
        upgrades_to_settings: gap(boxes.upgradesTab, boxes.settingsTab),
        settings_to_cash: gap(boxes.settingsTab, boxes.cash),
        cash_to_pause: gap(boxes.cash, boxes.pauseBtn),
        pause_to_right_edge: boxes.pauseBtn ? +(vw - (boxes.pauseBtn.x + boxes.pauseBtn.w)).toFixed(1) : null,
      },
      cashOverlapsHud:
        intersects(boxes.cash, boxes.upgradesTab) ||
        intersects(boxes.cash, boxes.settingsTab) ||
        intersects(boxes.cash, boxes.pauseBtn),
      // Same check with a wide mid-game balance forced in — cash is centered
      // + nowrap, so its box grows both ways as the number grows.
      cashOverlapsHudLong: (() => {
        const counter = els.cash?.querySelector('div');
        if (!counter) return null;
        const orig = counter.textContent;
        counter.textContent = '999.9K';
        const wide = box(els.cash);
        const hit =
          intersects(wide, boxes.upgradesTab) ||
          intersects(wide, boxes.settingsTab) ||
          intersects(wide, boxes.pauseBtn);
        counter.textContent = orig;
        return hit;
      })(),
      canvasFillsViewport: boxes.canvas ? boxes.canvas.w >= vw - 1 && boxes.canvas.h >= vh - 1 : false,
    };
  });
}

async function measureMenu(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const panel = [...document.querySelectorAll('div')].find(
      (e) => e.style.position === 'fixed' && e.style.zIndex === '16' && e.getBoundingClientRect().width > 200
    );
    if (!panel) return { open: false };
    const r = panel.getBoundingClientRect();
    const buttons = [...panel.querySelectorAll('button')]
      .map((b) => b.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    const minBtn = buttons.reduce((m, b) => Math.min(m, Math.min(b.width, b.height)), Infinity);
    const fonts = [...panel.querySelectorAll('button, div, span')]
      .filter((e) => e.textContent.trim() && !e.children.length)
      .map((e) => parseFloat(getComputedStyle(e).fontSize));
    // Ship-blocker probe: every one of the 5 tab pills must be REACHABLE —
    // in view already, or scrollable into view inside a scrollable bar.
    const tabLabels = ['Garage', 'Market', 'Gas Station', 'Player', 'Advertising'];
    const tabBtns = [...panel.querySelectorAll('button')].filter((b) => tabLabels.includes(b.textContent));
    const bar = tabBtns[0]?.parentElement;
    let tabsReachable = false;
    if (bar && tabBtns.length === 5) {
      const barScrollable = getComputedStyle(bar).overflowX === 'auto';
      tabsReachable = tabBtns.every((b) => {
        b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
        const r = b.getBoundingClientRect();
        return r.left >= -1 && r.right <= vw + 1 && r.width > 30;
      });
      bar.scrollLeft = 0; // restore for the screenshot
      tabsReachable = tabsReachable && (barScrollable || bar.scrollWidth <= bar.clientWidth + 1);
    }
    return {
      tabsReachable,
      open: true,
      panel: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      onScreen: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1,
      minButtonPx: +minBtn.toFixed(1),
      minFontPx: +Math.min(...fonts).toFixed(1),
      buttonCount: buttons.length,
    };
  });
}

// ---------------------------------------------------------------- runner ---
mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] }); // WebGL2 in headless
const results = [];

for (const cfg of matrix) {
  const label = `${cfg.name}-${cfg.orient}-${cfg.w}x${cfg.h}@${cfg.dpr}`;
  const ctx = await browser.newContext({
    viewport: { width: cfg.w, height: cfg.h },
    deviceScaleFactor: cfg.dpr,
    isMobile: cfg.touch,
    hasTouch: cfg.touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE_URL, { waitUntil: 'load' });
  // Loading overlay = the fixed 'Loading…' div; removed once models are in.
  await page.waitForFunction(() => ![...document.querySelectorAll('div')].some((d) => d.textContent === 'Loading…'), {
    timeout: 30000,
  });
  await page.waitForTimeout(2500); // settle: camera snap, tutorial bubble, first frames

  await page.screenshot({ path: `${OUT_DIR}/${label}-idle.png` });
  const hud = await measureHud(page);

  // Open the upgrade tablet via its tab (tap on touch devices).
  await page.locator('button', { hasText: 'Upgrades' }).first().click();
  await page.waitForTimeout(600); // slide-in animation
  await page.screenshot({ path: `${OUT_DIR}/${label}-menu.png` });
  const menu = await measureMenu(page);

  results.push({ label, cfg, math: analyze(cfg.w, cfg.h), hud, menu, errors });
  console.log(`${label}  aspect=${(cfg.w / cfg.h).toFixed(2)}  pits=${analyze(cfg.w, cfg.h).pitsVisible}  menuOpen=${menu.open}`);
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT_DIR}/measurements.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length} viewports captured -> ${OUT_DIR}/`);
