# Cross-Device Framing & Visibility Audit

**Scope:** production bundle (`npm run build`, served statically), 19 viewports ×
2 states (idle + upgrade tablet open) = 38 screenshots in `audit-screens/`,
plus DOM box measurements (`audit-screens/measurements.json`) and analytic
camera math. Tooling: `tools/device-audit.mjs` (Playwright; re-run with
`npx vite preview --config vite/config.prod.mjs --port 8081 &` then
`node tools/device-audit.mjs`). **No game code was changed.**

All captures are the first-run state (fresh save, tutorial step 1 bubble
visible) — exactly what a new YouTube Playables player sees.

---

## 1. Measurement table

Derived from `SceneManager.#onResize` + `settings` (viewSize 25, world halfX 48
/ halfZ 10, pits at x = −27…+27 step 13.5, z = 4; player spawn (−24.5, 0)).
On the isometric camera, 1 screen-horizontal unit = 1 ground unit along the
screen-x diagonal; 1 screen-vertical unit = √3 ground units along screen-y
(foreshortening). "Pits max" = most pits simultaneously in frustum with the
camera riding the row (binding axis in parens); "@spawn" = pits in frame on
the actual idle screenshot. "Playable %" = share of the visible ground patch
inside the building strip (|x| ≤ 48, |z| ≤ 10), sampled around the spawn.

| Viewport (CSS px) | Aspect | Ground across | Ground depth | Pits max | @spawn | Playable % |
|---|---|---|---|---|---|---|
| 360×800 @3 portrait | 0.45 | 25.0 | 96.2 | 3 (width) | 2 | 29.0 |
| 375×667 @2 portrait | 0.56 | 25.0 | 77.0 | 3 (width) | 2 | 36.3 |
| 393×852 @3 portrait | 0.46 | 25.0 | 93.9 | 3 (width) | 2 | 29.7 |
| 430×932 @3 portrait | 0.46 | 25.0 | 93.9 | 3 (width) | 2 | 29.7 |
| 768×1024 @2 portrait | 0.75 | 25.0 | 57.7 | 3 (width) | 2 | 48.4 |
| 820×1180 @2 portrait | 0.69 | 25.0 | 62.3 | 3 (width) | 2 | 44.8 |
| 800×1280 @1.5 portrait | 0.63 | 25.0 | 69.3 | 3 (width) | 2 | 40.3 |
| 800×360 @3 landscape | 2.22 | 55.6 | 43.3 | 5 (height) | 3 | 43.5 |
| 667×375 @2 landscape | 1.78 | 44.5 | 43.3 | 5 (width) | 3 | 51.1 |
| 852×393 @3 landscape | 2.17 | 54.2 | 43.3 | 5 (height) | 3 | 44.4 |
| 932×430 @3 landscape | 2.17 | 54.2 | 43.3 | 5 (height) | 3 | 44.4 |
| 1024×768 @2 landscape | 1.33 | 33.3 | 43.3 | 4 (width) | 3 | 58.6 |
| 1180×820 @2 landscape | 1.44 | 36.0 | 43.3 | 4 (width) | 3 | 57.0 |
| 1280×800 @1.5 landscape | 1.60 | 40.0 | 43.3 | 5 (width) | 3 | 54.3 |
| 1280×800 @1 laptop | 1.60 | 40.0 | 43.3 | 5 (width) | 3 | 54.3 |
| 1440×900 @2 laptop | 1.60 | 40.0 | 43.3 | 5 (width) | 3 | 54.3 |
| 1920×1080 @1 | 1.78 | 44.4 | 43.3 | 5 (width) | 3 | 51.1 |
| 2560×1440 @1 | 1.78 | 44.4 | 43.3 | 5 (width) | 3 | 51.1 |
| 3440×1440 @1 ultrawide | 2.39 | 59.7 | 43.3 | 5 (height) | 3 | 41.0 |

Sanity: every landscape shows exactly 25 units vertically (the anchor), every
portrait exactly 25 horizontally — the contain-fit works as designed, no black
bars anywhere, canvas fills the viewport at all 19 sizes, zero page errors.

---

## 2. Per-viewport verdicts

**PROBLEM — all four phone portraits** (`android-small-portrait-360x800@3-*`,
`iphone-se-portrait-375x667@2-*`, `iphone-15-portrait-393x852@3-*`,
`phone-large-portrait-430x932@3-*`):
1. **The cash counter is completely hidden behind the tab row.** The HUD money
   element is fixed top-center; the Upgrades+Settings tabs occupy the left
   ~310 CSS px at a fixed size. Under ~740 px width the screen's center falls
   inside the tab strip, and cash (z-index 15) renders UNDER the tabs
   (z-index 17). Measured horizontal overlap: −139 px (360w) to −109 px
   (430w). On every phone-portrait idle screenshot only a sliver of the 💵
   icon peeks out between the tabs. A phone-portrait player cannot see their
   money — the core idle-game number.
2. **Upgrade menu: Player and Advertising tabs are unreachable.** The tab bar
   (`UpgradeMenu.js #buildTabs`) is non-wrapping flex with no horizontal
   scroll, inside the frame's `overflow: hidden`. At 360/375 w only 3 of 5
   tabs are visible; at 393 the 4th is clipped mid-label ("Pla…"); at 430 the
   5th is fully gone. Player Speed and the two ad/reputation buys cannot be
   accessed at all in phone portrait (evidence:
   `iphone-15-portrait-393x852@3-menu.png`).
3. Framing: only ~29–36 % of the screen is playable interior; the rest is
   grass/road. The 96-unit vertical ground span (vs the world's 20-unit room
   depth) is the known portrait-filler problem, confirmed. Functional but the
   weakest presentation in the matrix.

**ACCEPTABLE — iPhone SE landscape** (`iphone-se-landscape-667x375@2-*`):
everything works, but the cash block's left edge already overlaps the Settings
tab's box by 7.5 px with the trivial "0" balance. The cash element is centered
and `whiteSpace: nowrap`; a mid-game "999.9K" roughly doubles its width, which
will push it visually into the Settings tab at ≤700 px widths. At-risk, not
yet broken.

**GOOD — remaining phone landscapes** (800×360, 852×393, 932×430): full room
height in frame, 5-pit capacity, cash clear of both corners, menu fits within
88 vh even at 360 px tall with all 5 tabs visible. Minor cosmetic: world-space
unlock-marker labels ("Gas Station Unlock", "Hire Cashier") slide under the
top-left tab row at certain camera positions — they're world-anchored, so this
is transient.

**GOOD — all tablets, both orientations** (768×1024, 820×1180, 1280×800):
best-balanced views in the matrix (45–59 % playable). Tablet portrait shows
cash correctly (first clear width is 768). Menu comfortable, all tabs visible.

**GOOD — laptop/desktop 1280–2560**: consistent 40–44.4 units across, whole
5-pit row within capacity, HUD proportionate, menu (fixed 1050×840 px,
right-anchored) comfortable. At 2560×1440 the fixed-px HUD starts to feel
small relative to the screen but remains perfectly usable with a mouse.

**ACCEPTABLE — ultrawide 3440×1440** (`ultrawide-landscape-3440x1440@1-*`):
the fit math survives (no black bars; 59.7 units across — the frustum is wider
than the whole 48-unit half-room, so big grass margins flank the world). The
game reads as a small island in the center; the upgrade tablet hugs the right
edge ~1.5 m of screen away from the world; HUD corners are very far apart.
Playable, but the most diluted presentation.

**Cross-cutting (all viewports):**
- Menu's smallest interactive element measures 30×30 CSS px (the header
  close/X and the LOCKED pill area) and smallest text 11 px — below the ~44 px
  touch-target guideline on every touch device.
- The tutorial bubble overlaps the opened menu (covers the Market/Gas-Station
  tab labels on short landscape screens, e.g.
  `iphone-se-landscape-667x375@2-menu.png`) and hides the player character at
  spawn on phone portrait. Transient (tutorial-only), worth knowing.
- `SceneManager` caps `setPixelRatio` at 2, so @3 devices render at 2× and
  upscale — a deliberate perf trade; slight softness on 460-ppi phones.

---

## 3. Consistency summary

- **Horizontal world shown: 25 → 59.7 units = 2.39× spread** between any phone
  portrait and the ultrawide — exactly the two extremes predicted. Landscape
  aspect alone spans 33.3 → 59.7 (1.8×).
- **Vertical ground shown: 43.3 → 96.2 units = 2.2× spread** in the opposite
  direction (portrait pays its narrow width back as mostly-empty depth: the
  room is only 20 units deep, so everything past ~35 units of depth is grass
  and road).
- Total visible ground *area* is nearly constant (~2 400–2 600 units²
  everywhere) — contain-fit conserves area, but **shape diverges wildly**, and
  the useful share of that area swings **29 % → 59 %**. That, not raw zoom, is
  the real inconsistency: a phone-portrait player spends 71 % of their pixels
  on filler; an iPad-landscape player 41 %.
- Pit-row context: portrait can never see more than 3 pit positions at once
  (2 from spawn); anything ≥ 1.53 aspect can see all 5. Late-game, a portrait
  player managing pits D/E plays "through a keyhole", walking blind between
  stations that a landscape player sees simultaneously.
- The experience is effectively three different games: cramped keyhole
  (phone portrait), intended framing (phone landscape/tablet/laptop,
  1.33–1.78), and diluted island (≥2.2 aspect).

---

## 4. Recommendations (ranked by impact — NOT implemented)

1. **Make all 5 menu tabs reachable on narrow screens (bug-level, ship
   blocker).** In `src/scene/UpgradeMenu.js #buildTabs`: either
   `flexWrap: 'wrap'` on the bar, or `overflowX: 'auto'` +
   `WebkitOverflowScrolling` with an edge-fade affordance; optionally shrink
   tab padding/font under a width threshold. Touches only `UpgradeMenu.js`;
   no new settings needed (or `settings.ui.menuTabBreakpoint` if you gate a
   compact style).

2. **Unhide the cash counter on narrow widths (ship blocker).** The tab row +
   centered cash cannot coexist in <~740 px. Cheapest fix: in
   `src/scene/Hud.js`, when `innerWidth < settings.ui.narrowBreakpoint`
   (new constant, ~740), drop the cash wrap below the tab row (top offset =
   tab height + margin) — corner buttons stay put, cash stays centered but one
   line lower. Alternative: collapse the Upgrades/Settings tabs to icon-only
   below the breakpoint (touches `UpgradeMenu.js`/`SettingsMenu.js` label
   spans). Either also cures the iPhone-SE-landscape near-overlap. New
   constant: `settings.ui.narrowBreakpoint`.

3. **Aspect-clamped portrait fit (framing quality).** In
   `SceneManager.#onResize`, cap how far the portrait branch may stretch
   vertically: `const stretch = Math.min(1 / aspect,
   settings.camera.portraitMaxStretch)` (≈1.5–1.6 ⇒ ~37–40 units of ground
   depth) and use `half * stretch` for top/bottom **and scale the horizontal
   half down by `aspect * stretch`** — i.e. below aspect ≈ 0.63 the view
   zooms in instead of piling on empty grass. Numbers at 360×800: depth drops
   96 → ~40 units, playable share ~29 % → ~50 %, at the cost of horizontal
   context (25 → ~18 units, ~1.3 pit spacings — @spawn count stays 2, and the
   camera already follows the player). Pairs well with a small
   `settings.camera.portraitZBias` (shift the follow target a few units
   toward the room, −z) so the depth budget centers on the building rather
   than symmetric grass. Touches `SceneManager.js` + `settings.camera`
   (`portraitMaxStretch`, optional `portraitZBias`). This is the single
   biggest "game size consistency" lever; verify with the same audit script.

4. **Ultrawide clamp (polish).** Same idea on the other end: in the landscape
   branch, `const grow = Math.min(aspect, settings.camera.maxAspectGrow)`
   (≈2.0 ⇒ 50 units max across) and scale the vertical half up by
   `aspect / grow` past it. Prevents >2.2-aspect screens from turning the
   world into an island and keeps the max/min horizontal ratio at 2.0×
   instead of 2.39×. Touches `SceneManager.js` + `settings.camera.maxAspectGrow`.

5. **Menu touch ergonomics.** Bump the 30 px close/X and any sub-44 px
   interactive elements to ≥44 px, and the 11 px status text to ≥12–13 px on
   touch devices (`UpgradeMenu.js`; the values are inline styles). Low effort;
   matters on every phone/tablet, and YouTube Playables review checks tap
   targets.

6. **World-label vs HUD collision (cosmetic).** Top-left unlock-marker labels
   render beneath the tab row when the camera puts them there. If it bothers
   QA: draw marker labels into the canvas with a top screen-margin fade, or
   accept — they're world-anchored and transient.

Not recommended: changing `viewSize` (25) globally — landscape framing is
tuned and consistent (43.3 units of depth everywhere); the problems are
confined to the two aspect extremes and the fixed-px DOM HUD.

---

## 5. What this audit cannot verify headlessly (manual test list)

- **Real touch feel:** joystick reachability/thumb ergonomics, tap accuracy on
  moving cars, drag-vs-tap discrimination — screenshots prove geometry, not feel.
- **Safe-area insets:** HUD uses `env(safe-area-inset-top)`, but headless has
  no notch/home-bar; verify on a real iPhone (Playables webview) that tabs and
  pause clear the notch in landscape.
- **DPR rendering quality:** the pixel-ratio-2 cap on @3 screens (softness),
  and font/hairline rendering at 1.5 DPR Android.
- **Performance:** SwiftShader ≠ real GPUs; check sustained FPS + thermals on
  a low-end Android (Mali/Adreno) and an older iPad, especially with shadows
  (2048 shadow map) at 2× DPR.
- **In-product embedding:** YouTube Playables chrome may inset or letterbox
  the iframe; the audit assumed the game owns the full viewport.
- **Orientation change at runtime:** rotating mid-session (resize handler
  exists, but state after rotate + open menu is untested here).
- **Audio/autoplay + gesture unlock** across the webviews.

*Audit artifacts: `audit-screens/*.png` (38), `audit-screens/measurements.json`,
`tools/device-audit.mjs`. Generated 2026-07-11.*

---

## 6. Post-fix results (2026-07-11, recommendations 1–5 + tutorial overlap)

Implemented in: `settings.js` (new: `camera.portraitMaxStretch` 1.6,
`camera.portraitZBias` 2, `camera.maxAspectGrow` 2.0, `ui.narrowBreakpoint`
860, `ui.narrowCashDrop` 52, `ui.menuTabBreakpoint` 480,
`tutorial.bubblePlayerClearance` 12), `SceneManager.js` (clamped fit + portrait
follow bias), `Hud.js` (cash drops a row below `narrowBreakpoint`, live on
resize), `UpgradeMenu.js` (scrollable tab bar + edge fade + compact pills,
44 px targets, 12 px min text), `SettingsMenu.js` (44 px close/mute/slider),
`TutorialView.js` (bubble hidden while the tablet is open for world/info
steps; clamped + kept clear of the player). `npm test`: **173 passed**. The
audit harness was updated to mirror the clamps and to probe the blockers
directly (true rect intersection incl. a forced **"999.9K"** balance, and
scroll-into-view reachability of all 5 tabs).

**All 19 viewports pass every check**: cash never intersects the tab row or
pause button (short AND long balance), all 5 menu tabs reachable everywhere
(incl. 360×800), canvas fills every viewport (no black bars), zero page
errors, menu min interactive element 44 px, min font 12 px.

| Viewport | Across | Frustum ↕ | Ground depth | Pits max | @spawn | Playable % |
|---|---|---|---|---|---|---|
| 360×800 portrait | 25 → **18** | 55.6 → **40** | 96.2 → **69.3** | 3 → 2 | 2 | 29.0 → **40.8** |
| 375×667 portrait | 25 → 22.5 | 44.5 → 40 | 77.0 → 69.3 | 3 | 2 | 36.3 → 40.8 |
| 393×852 / 430×932 portrait | 25 → 18.5 | 54.2 → 40 | 93.9 → 69.3 | 3 → 2 | 2 | 29.7 → 40.8 |
| 768×1024 / 820×1180 / 800×1280 portrait | 25 | ≤40 (unclamped ≤0.63) | 57.7–69.3 | 3 | 2 | 40.7–48.8 |
| 667×375 landscape | 44.5 | 25 | 43.3 | 5 | 3 | 51.1 (unchanged) |
| 800×360 / 852×393 / 932×430 landscape | 54–55.6 → **50** | 25 → 22.5–23.1 | 43.3 → 39–40 | 5 | 2 | 43.5–44.4 → 49.1–49.6 |
| 1024×768 → 2560×1440 | 33.3–44.4 | 25 | 43.3 | 4–5 | 3 | 51.1–58.6 (**identical to pre-fix**) |
| 3440×1440 ultrawide | 59.7 → **50** | 25 → 20.9 | 43.3 → 36.3 | 5 → 4 | 2 | 41.0 → **51.1** |

Consistency: the landscape horizontal spread tightened from 33.3–59.7 (1.8×)
to 33.3–50 (**1.5×**). Portrait now shows 18–25 units across instead of a
fixed 25 — narrower *by design*: the zoom-in trades horizontal context for
less dead grass, which is what the playable-share metric rewards. The share
of the screen that is actual game is now **40.7–58.6 % across the whole
matrix** (was 29–58.6 %): the worst viewport gained ~12 points and the
useful-pixels divergence between best and worst roughly halved (2.0× → 1.4×).

Notes / deliberate trade-offs:
- `maxAspectGrow` 2.0 also mildly clamps 20:9 **phone landscapes** (2.17–2.22
  aspect): 54.2 → 50 units across. Bump it to ~2.25 in `settings.js` if those
  should stay unclamped and only true ultrawide should clip.
- Portrait pit capacity drops 3 → 2 on ≤0.46 aspect (the zoom-in trade the
  audit predicted); the camera follows the player, and pit capacity on
  everything ≥4:3 landscape is unchanged.
- `narrowBreakpoint` started at the audit's 740 but the long-balance probe
  caught "999.9K" still clipping the Settings tab at 768 w — raised to 860
  (the breakpoint moved, not the layout logic). iPad-portrait widths now also
  use the dropped cash row.
- `portraitZBias` started at 3 but that pushed the spawn-adjacent pit-A car
  into the tutorial arrow's edge margin at 360 w; 2 keeps it framed.

### Residual manual checklist (real device / by eye)
1. **Portrait feel**: does `portraitMaxStretch` 1.6 (18–22.5 units across)
   feel cramped on a real phone? Tune in `settings.camera` — higher = more
   grass, lower = tighter. Same for `portraitZBias` 2 (framing balance).
2. **Corner walk in portrait**: walk to all four room corners + the gas
   station — confirm the biased follow target never fights or jitters at the
   bounds (it shouldn't: the bias is pre-lerp and nothing clamps the camera).
3. **Rotate mid-session with the menu open**: portrait↔landscape — cash row
   re-places, tab pills re-size, edge fade updates, no stuck layout.
4. **Long balance on a real run**: bank ≥ 999.9K and check the cash row on an
   ~800–860 px-wide screen (the breakpoint boundary) in both orientations.
5. **Tab-bar scroll feel** on a real touch screen at 360–430 w: momentum,
   the peeking pill + fade affordance, no accidental tab taps while swiping.
6. **Tutorial pass on a phone**: bubble never covers the character or the
   open tablet; the edge arrow still appears when the target is truly
   off-screen.
