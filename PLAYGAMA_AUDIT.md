# Playgama + YouTube Playables Compliance Audit

Read-only audit of `garage-idle-3d` (vanilla JS + Three.js 0.169, Vite 6) against
the Playgama publishing requirements (wiki.playgama.com, fetched 2026-07-10) and
the YouTube Playables requirements. No game files were modified.

**Verdicts**: PASS / FAIL / NEEDS MANUAL CHECK / N/A.

**Headline numbers** (from a real `npm run build`):
- Total `dist/`: **~10 MB**, 60 files. Audio 5.2 MB, GLB models 3.2 MB, JS 772 KB
  (204 KB gzipped), images 932 KB, font 452 KB.
- **Playgama Bridge SDK: not integrated at all** — the single biggest blocker.
  `storage.js` / `ads.js` are deliberately isolated stubs waiting for it.
- **No external network calls anywhere** (source or built bundle) — YouTube-clean.
- **No pause-on-minimize and no full mute** — the two clearest behavioral FAILs.

---

## Technical Requirements

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Playgama Bridge is integrated | **FAIL** | No `@playgama/bridge` in `package.json` (deps: `three` only), no bridge script in `index.html`, no init/game-ready call anywhere (`grep -ri playgama src/` → only comments). `src/platform/storage.js:2-4` and `src/platform/ads.js:2-4` explicitly describe themselves as stubs to be swapped for Bridge later. |
| 2 | No registration/authorization required | **PASS** | No auth code exists; game boots straight into gameplay (`src/main.js:118`). |
| 3 | No embedded analytics (GA4 etc.) | **PASS** | Grep of source AND minified `dist/assets/*.js` finds no fetch/XHR/WebSocket/sendBeacon/gtag/analytics. Only URLs in the bundle are the inert `w3.org` SVG/XHTML namespace strings. |
| 4 | Meets device requirements in publication request | NEEDS MANUAL CHECK | Depends on what you declare. Note the WebGL2 constraint in #26–27 below before declaring old devices. |
| 5 | Mobile: runs full-screen | **PASS** (verify visually) | Canvas container is `#app { position: fixed; inset: 0 }` (`public/style.css:33-36`), viewport meta has `viewport-fit=cover, user-scalable=no` (`index.html:6`). Playgama serves games in a full-screen iframe; nothing here fights it. |
| 6 | Mobile: keyboard appears for input fields | **N/A** | The only input element is a `range` slider (`src/scene/SettingsMenu.js:173`); there are no text fields. |
| 7 | Mobile: no deformation on orientation change | **PASS** (verify visually) | `SceneManager.#onResize` (`src/scene/SceneManager.js:112-135`) recomputes the ortho frustum from live aspect on every `resize` (fired on orientation change) with a contain-fit for both portrait and landscape. |
| 8 | Single-orientation placeholder | **N/A** | Both orientations are genuinely supported (same resize code). |
| 9 | Progress saved on orientation change | **PASS** | Autosave every 5 s (`src/main.js:116`, `settings.persistence.autoSaveInterval`) plus explicit `saveGame` after purchases/ads (`src/scene/UpgradeMenu.js:519,530,747`, `BreakMenu.js:116`, `TruckMenu.js:117,126`). Orientation change never loses more than 5 s. |
| 10 | Mobile: fully gesture-controlled | **PASS** | Movement via touch-anywhere virtual joystick (`src/scene/Input.js`, Pointer Events), all actions via canvas taps (`src/main.js:162-257`) and DOM buttons. Keyboard (WASD/arrows) is a supplement, not a requirement. |
| 11 | Mobile: no system video player appears | **N/A** | No video anywhere in the game. |
| 12 | Mobile: no WebGL notification on open | NEEDS MANUAL CHECK | No notification code exists, but see the WebGL2 risk (#26–27): on a device without WebGL2 the `THREE.WebGLRenderer` constructor throws and the game silently stays on a black page — no message, no fallback. Test on the oldest device you intend to declare. |
| 13 | Desktop: active field stretches to window edges | **PASS** | `#onResize` sizes renderer to `window.innerWidth/innerHeight` (`SceneManager.js:113-114,134`); `#app` is fixed full-viewport. |
| 14 | Desktop: active-field aspect ≤ 1:2 | **PASS** | The canvas always fills the whole viewport; no fixed-aspect container exists. |
| 15 | Desktop: no deformation on resize | **PASS** | Same contain-fit resize path as #7. |
| 16 | Desktop: keyboard or mouse control by default | **PASS** | WASD/arrow keys (`src/scene/Input.js:79-110`) and full mouse support via Pointer Events (joystick + taps). |
| 17 | Desktop: no system player | **N/A** | No video. |
| 18 | Scale within screen bounds, no cut-off elements | NEEDS MANUAL CHECK | Camera contain-fits the world, but HUD/tablet-menu fit on very small screens (≤ 360 px wide, both orientations) needs eyes-on testing. The Settings tab is pinned at `left: 164px` (`SettingsMenu.js:23`) to clear the Upgrades tab — check they don't collide with the cash HUD on narrow portrait. |
| 19 | No browser page scrolling | **PASS** | `html, body { overflow: hidden }` + `body { touch-action: none }` (`public/style.css:18-31`). |
| 20 | No overlapping elements/texts | NEEDS MANUAL CHECK | Visual QA item — check tutorial bubbles, pit labels, break LED panels, and the queue of top-left tabs at several window sizes. |
| 21 | All pop-ups have a close button | **PASS** | ✕ buttons on Settings (`SettingsMenu.js:135-151`), Upgrades tablet (`UpgradeMenu.js:265-281`), Break panel (`BreakMenu.js:44-60`), Truck panel (`TruckMenu.js:45-61`). Tutorial finale popup auto-dismisses after 8 s or on tap (`settings.tutorial.finalePopupSeconds`). |
| 22 | One-handed control possible | **PASS** (verify) | Joystick spawns wherever the thumb lands (`Input.js` dynamic anchor); all taps are single-touch. |
| 23 | No technical messages/errors/crashes/freezes | NEEDS MANUAL CHECK | Requires a long-session soak test. Code is defensive (audio `.catch(() => {})`, storage try/catch), but only play-testing proves it. |
| 24 | No URL-based operation limiting | **PASS** | No `location`/origin checks anywhere in `src/`. |
| 25 | Browsers: Chrome, Firefox, Opera, Safari, Edge | NEEDS MANUAL CHECK | Standard APIs only (Pointer Events, ES modules, WebGL2). Safari needs WebGL2 → Safari 15+. Test in each. |
| 26 | Desktop OS: Windows Vista+, macOS 10.6+ | NEEDS MANUAL CHECK | Browsers old enough to run on Vista won't have WebGL2/ES-module support. In practice "modern evergreen browser" is the real floor — declare accordingly. |
| 27 | Mobile OS: Android 5.0+, iOS 9.0+ | **FAIL** (as literally stated) | Three.js 0.169 is **WebGL2-only** (WebGL1 support removed in r163; confirmed in `node_modules/three` r0.169.0). iOS < 15 and old Android WebViews have no WebGL2 → the game cannot run on iOS 9–14. Either declare higher minimums in the publication request or this is unmeetable without downgrading Three.js. |
| 28 | Total upload ≤ 300 MB | **PASS** | `dist/` is ~10 MB, 60 files. |
| 29 | `index.html` at archive root | **PASS** | `dist/index.html` exists; all asset URLs are relative (`base: './'`, `vite/config.prod.mjs:4`). |
| 30 | Latin-only file/folder names | **PASS** | All names are Latin. (Housekeeping: `dist/models/.DS_Store` and `dist/.DS_Store`-type junk files are copied from `public/` — harmless but should be removed.) |

## Advertising Requirements

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Ads only through Playgama Bridge | **FAIL** | `src/platform/ads.js:6-8`: `showRewardedAd(onComplete)` just calls `onComplete()` immediately — rewards are granted with **no ad shown at all**. No third-party ad code exists (good), but moderation will reject a "Watch Ad" button that plays no ad. Must be wired to Bridge's rewarded API. |
| 2 | Payments only through Bridge | **N/A** | No purchases/IAP of any kind in the game. |
| 3 | Progress saved across ad transition | **PASS** | `saveGame(state)` is called inside every rewarded-ad completion callback (`UpgradeMenu.js:530`, `BreakMenu.js:116`, `TruckMenu.js:126`) plus the 5 s autosave. |
| 4 | Ad orientation matches game | N/A (until Bridge) | Bridge controls ad rendering; nothing game-side to check yet. |
| 5 | Ads only at logical pauses | **PASS** (rewarded) / note | All three ad entry points are user-initiated buttons in modal panels — inherently paused moments. No interstitials exist yet; if added, natural slots are: after the tutorial finale, on the offline-earnings popup at session start, and after an unlock-marker purchase completes. |
| 6 | No ad blocks under finger/cursor | N/A (until Bridge) | No ad rendering exists game-side. |
| 7 | Rewarded ads voluntary via a button | **PASS** | Three explicit buttons: reputation (`UpgradeMenu.js:525-530`), wake worker (`BreakMenu.js:85`), call truck (`TruckMenu.js:98`). |
| 8 | Clear text: it's an ad + what reward | **PASS** | Labels: `Watch Ad (+5% reputation)` (`UpgradeMenu.js:678`), `Watch Ad to Wake Up` (`BreakMenu.js:85`), `Call Truck Early (Watch Ad)` (`TruckMenu.js:98`). |
| 9 | Rewards are additional bonuses | **PASS** | Rewards are accelerators (permanent rep step with 30-min cooldown — `settings.reputation.adRewardStep/adCooldownSeconds`; early break wake-up; early truck). Core progress is never gated on ads: breaks end on a timer, trucks arrive on a timer, reputation is also buyable with cash. |
| 10 | No "+1 life on every loss" pattern | **PASS** | No lives/fail state exists. |
| 11 | Extra ad blocks only sticky banners | N/A | No extra ad blocks. |
| 12 | No custom RTB banners | **PASS** | None. |
| 13 | Sound + gameplay paused during full-screen ads | **FAIL** | Nothing pauses. `showRewardedAd` is synchronous-stub; there is no pause mechanism at all — the rAF loop (`src/main.js:311-415`) and all `Audio` elements (`src/platform/audio.js`) keep running. When Bridge is wired, an ad must freeze `tick()` (e.g. a `paused` flag around `main.js:320-322`) and silence all audio. |

## User Experience Requirements

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Has progress / engagement / plot | **PASS** | Full idle-tycoon progression: cash, upgrades, 5 pits, market, endgame gas station (`src/core/upgrades.js`), tutorial. |
| 2 | Save option for progression games | **PASS** | Versioned autosave (`src/platform/storage.js`, `SAVE_VERSION` 19). |
| 3 | Record save for endless/high-score games | **N/A** | Not a high-score game. |
| 4 | Properly saves player progress | **PASS** (with a caveat) | 5 s autosave + save-after-purchase. Caveat: a `SAVE_VERSION` mismatch **discards** the save (`storage.js:43`) — every future update that bumps the version wipes players' progress. Acceptable pre-launch; after launch you'll want migrations, or moderation/users will see "progress lost after update". |
| 5 | Increasing difficulty / clear setting | **PASS** | Geometric costs (`cost = base × growth^level` throughout `settings.upgrades`), reputation-gated land (`settings.pit.unlockReputation`), endgame prereqs (`upgrades.gasStationPrereqs`). Clear garage/mechanic setting. |
| 6 | Not silent — music + SFX | **PASS** | Looping music + 3 ambience layers + hammer/money/bag/door SFX (`src/platform/audio.js`). |
| 7 | Mute button implemented | **FAIL** | The Settings panel has only a **Music Volume** slider (`SettingsMenu.js:167,184-187` → `setMusicVolume`), which affects `bgmusic` only. Ambience layers and all sound effects (hammer, money, bag, doors) have **no mute or volume control at all**. A one-tap master mute is required. |
| 8 | Sound stops when page minimized | **FAIL** | There is **zero** `visibilitychange`/`blur`/`pagehide` handling in the codebase (grep confirms). HTMLAudioElements keep playing when the tab is hidden; `requestAnimationFrame` throttling pauses the *game*, but music/ambience keep sounding. This is also self-check item 5. |
| 9–12 | Language selection UX (flags/native names, icon-only menus) | **N/A** (declare EN only) | The game is English-only with no language menu. These requirements apply only to games declaring multiple languages. If you declare more than English, all UI strings are hardcoded English (`Hud.js`, `UpgradeMenu.js`, `tutorial.js` step texts) and would FAIL — declare `en` only. |

## Content Requirements

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1–5 | No violence/abuse, politics, religion, health/death predictions | **PASS** | Content is cars, tires, groceries, gas pumps. Nothing remotely close. |
| 6–7 | Materials copyrighted by creator; submitted by creator | NEEDS MANUAL CHECK | Code is original (MIT `LICENSE` at repo root). The GLB models (`public/models/` — character rigs, cars, shelving; flat `colormap.png` palette texture) look like Kenney/KayKit-style CC0 packs and the 10 MP3s + `montserrat.black.ttf` have no license files in the repo. **Collect and keep the license/receipt for every model, sound, and the font** (Montserrat is SIL OFL — fine, but keep the OFL text). |
| 8–9 | Not a copy of a catalog game / own duplicate | NEEDS MANUAL CHECK | Genre (idle garage/mechanic tycoon) is crowded; this implementation is original code with its own systems. A human should confirm no catalog title is too close. |
| 10 | Sequel rules | **N/A** | Not a sequel. |
| 11–12 | No copyrighted names, brand logos, music | **PASS** (code/assets) + manual for audio | No brand strings anywhere in source or asset names (`taxi.glb`, `cop.glb`, `SUV.glb`, `sports.glb` are generic). Music provenance must be verified by you (see 6–7). |
| 13–14 | AI-asset rules | **N/A** | No indication of wholesale AI-generated content. |
| 15–18 | No real-money transactions, prizes, gambling, external purchases | **PASS** | The only currency is fictional in-game cash; no IAP code exists. |
| 19–21 | Video integration rules / no YouTube player | **N/A** | No video integration. |

## Other Requirements

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1–3 | No third-party rights infringement, no brand impersonation | **PASS** (pending asset-license check above) | Generic theme, no brands referenced. |
| 4 | User-data permission | **N/A** | No user data is collected; saves are local game state only. |
| 5–22 | Illegal content, violence, erotica, hate, suicide, extremism, obscenity | **PASS** | Family-safe tycoon content; all UI strings reviewed — no profanity. |
| 23 (rec.) | Home + pause buttons | **FAIL** (recommended only) | No pause button exists anywhere; there is no way to pause the simulation. Low effort to add and it's a prerequisite for ad-pausing (Advertising #13) anyway. |
| 24–25 (rec.) | Portrait + landscape support | **PASS** | Contain-fit resize supports both (`SceneManager.js:112-135`). |

## Platform-Specific Requirements (non-YouTube, brief)

- **Facebook**: size 10 MB < 200 MB PASS; 60 files < 500 PASS; "loading under 3 s" NEEDS MANUAL CHECK (see YouTube §1 note on startup loading); needs ≥2 of IAP/leaderboards/multiplayer/social — **FAIL** as-is (has none).
- **MSN**: 10 MB < 50 MB PASS; landscape supported PASS.
- **Playdeck / TikTok / Xiaomi / GameSnacks**: size limits all PASS (10 MB; largest single file `bgmusic.mp3` 2 MB < 10 MiB). Playdeck's "platform saves only" **FAIL** (localStorage) — same fix as Bridge storage. GameSnacks save < 500 KiB PASS (save JSON is a few KB).
- **CrazyGames**: "load ≤ 5 s", polish, 20+ min engagement — NEEDS MANUAL CHECK. No black bars PASS.
- **Playhop/Yandex & VK**: **FAIL** if targeted — no Russian localization (all strings hardcoded English). VK's "no pre-existing progress on first launch" PASS (`createInitialState()` on empty storage); "blockers regenerate" PASS (breaks/trucks are timers).
- **Discord**: **FAIL** if targeted — no IAP, no multiplayer.

## Game Self-Check

| # | Item | Verdict |
|---|---|---|
| 1 | Bridge SDK integrated, Game Ready sent, saves via SDK | **FAIL** — none of the three (see Technical #1). |
| 2 | Not low-quality AI-generated | **PASS** — hand-built systems, tuned content. |
| 3 | Translated into all declared languages | **PASS if declared EN-only**. |
| 4 | Ads configured, sound pauses during ads, rewards delivered | **FAIL** — stub ads, no pause (Advertising #1, #13). Rewards themselves are delivered correctly. |
| 5 | Sound pauses on ads/minimize | **FAIL** (UX #8). |
| 6 | Progress saved correctly | **PASS** (UX #4, note the version-wipe caveat). |
| 7 | No technical messages/errors/crashes | NEEDS MANUAL CHECK (soak test). |
| 8 | Name consistent across game + draft | NEEDS MANUAL CHECK — current `<title>` is "Garage 3D — low-poly idle" (`index.html:8`); make it match the store draft. |
| 9 | No bugs/usability issues | NEEDS MANUAL CHECK. |
| 10 | UI visible within game area | NEEDS MANUAL CHECK (Technical #18). |
| 11 | No copyright violations | NEEDS MANUAL CHECK (Content #6–7). |
| 12 | Not a catalog copy | NEEDS MANUAL CHECK. |
| 13 | No integrated analytics | **PASS**. |

---

## YouTube Playables

### 1. Initial build ≤ 30 MB — **PASS** (~10 MB measured)

Real `npm run build` output (`dist/`, 60 files, ~10 MB):

| Category | Size | Notes |
|---|---|---|
| Audio (10 × mp3) | **5.2 MB** | `bgmusic.mp3` 2.0 MB, three ambience tracks 0.86–0.92 MB each. All four looping tracks start downloading at init (`initMusic`/`initAmbience`, `src/main.js:94-97`). `walk.mp3` (64 KB) is **unreferenced** — dead weight. |
| GLB models (33) | **3.2 MB** | Biggest: `Truck.glb` 320 KB, `sports.glb` 248 KB, `SUV.glb` 212 KB, `cop.glb` 208 KB. `display_bread.glb`, `gas_tank.glb`, `multiplecardboardboxes.glb`, `Textures/colormap.png` are **unreferenced** (~90 KB dead). |
| Images (6 png) | 932 KB | Shelf-sign photos + HUD icons; `veg.png` 208 KB / `money.png` 192 KB are large for their on-screen size. |
| JS (2 chunks) | 772 KB raw / **204 KB gz** | `three` chunk 532 KB (133 KB gz), game 240 KB (71 KB gz). |
| Font | 452 KB | `montserrat.black.ttf` — a WOFF2 subset would be ~10× smaller. |

Startup vs lazy-loadable: JS + font + all GLBs are loaded before the loading
overlay clears (`main.js:124-131` preloads everything, including gas-station and
truck models that are hours away in progression); the 4.7 MB of looping audio
races alongside. If you ever need headroom: lazy-load `Truck.glb`,
`gas_pump.glb`, market models, and the ambience tracks after first paint; audio
re-encode (mono, ~64–96 kbps) would halve the biggest category. Not required at
10 MB.

### 2. Zero external calls — **PASS**

- Source: no `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`, no analytics, no
  CDN `<script>`/`<link>` (`index.html` references only local `/style.css`,
  `/favicon.png`, bundle).
- Built output: grep of `dist/assets/*.js` finds no network APIs and no URLs
  besides the inert `www.w3.org` namespace constants used by SVG `createElementNS`.
- All assets (font, audio, models, images) are served from the game's own origin
  with relative paths (`base: './'`).
- **Known conflict to plan for**: integrating the Playgama Bridge SDK (required
  for every other Playgama platform) will itself add external calls. The YouTube
  submission needs a separate build target where `src/platform/{ads,storage}.js`
  keep their current local implementations and no Bridge script is included —
  the platform layer was designed for exactly this swap, so make it a build-time
  alias (e.g. Vite `resolve.alias` per target) rather than a runtime check.

### 3. Portrait + landscape, no black bars — **PASS** (code) + visual check

- Renderer fills the viewport at all times: `#app { position: fixed; inset: 0 }`,
  `renderer.setSize(w, h)` on every resize (`SceneManager.js:134`).
- Frustum recomputed per resize with an explicit two-branch contain-fit:
  landscape anchors the vertical span, portrait anchors the horizontal span
  (`SceneManager.js:122-132`) — the world scales, never letterboxes; overflow
  areas show the scene's grass field (`GroundField.js` is sized to outrun the
  camera), not black.
- `orientationchange` is covered because every browser fires `resize` on rotation;
  the listener is `window.addEventListener('resize', …)` (`SceneManager.js:29`).
- NEEDS MANUAL CHECK for the DOM overlays: the tablet menu, tutorial bubbles, and
  the top-left tab row (`Upgrades` at 22px, `Settings` at 164px) in narrow
  portrait (~360×780) and short landscape (~780×360). The joystick is
  position-agnostic (spawns at touch point) so it reflows by construction.

### 4. Runs on all device types — **FAIL** (one real risk) + manual perf check

- **WebGL2 hard requirement, no fallback**: Three.js r169 dropped WebGL1. On any
  device/browser without WebGL2 (iOS < 15, older Android WebView, blocked-GPU
  desktops) `new THREE.WebGLRenderer()` at `SceneManager.js:12` throws and the
  player gets a silent black page — no message. At minimum add a WebGL2
  capability check with a friendly "device not supported" screen; that also
  satisfies Technical #12.
- Pixel ratio **is** clamped: `setPixelRatio(Math.min(devicePixelRatio, 2))`
  (`SceneManager.js:13`) — good.
- GPU load is moderate but not trivial: antialias on, `PCFSoftShadowMap` with a
  2048² shadow map (`SceneManager.js:12-15,80`), full-scene rendering with many
  skinned character clones late-game. NEEDS MANUAL CHECK on a low-end Android
  (measure FPS with 5 pits + market + gas station active). Dropping the shadow
  map to 1024 and `PCFShadowMap` is the first lever if it struggles.
- Input: both touch and keyboard/mouse fully covered (Technical #10/#16); no
  interaction is keyboard-only or hover-only.
- Textures are small (procedural canvas textures + a 12 KB colormap); memory is
  not a concern at this asset scale.

### 5. Average playtime ≥ 10 min — NEEDS MANUAL CHECK, estimate: comfortably met

From `src/config/settings.js` live values:

- The mandatory tutorial alone forces **25 completed manual repairs**
  (`settings.tutorial.repairCount`) plus a restock haul, a hire, a lot purchase,
  the market unlock, and a truck order — roughly 8–15 minutes of guided play
  before the player is even free-roaming.
- Balance anchor (settings comment, `settings.js:292-297`): a rusty car pays
  ~$4.80 per ~1.6 s of pit-0 work → ~$180/min early income. First arc: mechanic
  $180 → equipment/land for pit B ($900 land + ~$720 equipment + rep gate 10%,
  one free ad-watch or $120) lands around minutes 5–10.
- Mid/endgame is dramatically longer: pit E land needs 70% permanent reputation
  (≈13 advertising buys, ~$15K cumulative), and the gas station requires *every*
  pit, mechanic, speed and fixing-time upgrade maxed plus the market fully
  trained (`upgrades.gasStationPrereqs`) — multi-hour horizon, with 30-min ad
  cooldowns and 5-min worker breaks pacing sessions.
- Risk to verify by hand: session one being *too* slow (25 manual repairs before
  any automation) rather than too short.

### 6. Uniqueness / originality + category fit — NEEDS MANUAL CHECK

- Nothing in code or assets references other titles; asset names are generic
  (`taxi.glb`, `sports.glb`, `cop.glb`). Mechanics (idle garage + supermarket +
  gas station with physical unlock circles, walkable restocking, worker breaks)
  are a genre blend rather than a clone of a single known title. The closest
  well-known relatives are mobile "arcade idle" games (Gas Station Simulator-
  likes, My Mini Mart-likes) — a human should confirm distance from specific
  YouTube catalog entries.
- **Category fit: Casual / Simulation (idle-tycoon "arcade idle")**. Not Arcade
  (no reflex loop), not Puzzle. If the store taxonomy lacks Simulation, Casual
  is the fit.

---

## FIX LIST (all FAILs merged, quickest first)

1. **Pause all audio (and ideally the sim) on `visibilitychange`** — add one
   listener that pauses/resumes music, ambience, and the hammer loop; fixes UX #8
   / self-check 5. Touches: `src/platform/audio.js` (export `pauseAll`/`resumeAll`),
   `src/main.js`.
2. **Master mute button** — a speaker toggle in the Settings panel (persisted)
   that gates *every* Audio instance, SFX included; fixes UX #7. Touches:
   `src/platform/audio.js`, `src/scene/SettingsMenu.js`, `src/platform/storage.js`
   (one new key).
3. **Delete unused/junk shipped assets** — `walk.mp3`, `display_bread.glb`,
   `gas_tank.glb`, `multiplecardboardboxes.glb`, `models/Textures/colormap.png`,
   and all `.DS_Store` files under `public/`. Touches: `public/` only (~450 KB).
4. **Add a pause mechanism + WebGL2 guard** — a `paused` flag skipping the three
   `tick*` calls, wired to a small pause/home button (Other #23) and reused for
   ad-pausing; plus a WebGL2 capability check before constructing the renderer
   with a friendly unsupported-device message (Technical #12, YouTube #4).
   Touches: `src/main.js`, `src/scene/SceneManager.js`, small new UI element.
5. **Integrate Playgama Bridge SDK** (the big one — Technical #1, Advertising #1
   & #13, self-check 1 & 4): init before boot, send the game-ready signal after
   the loading overlay clears (`main.js:131`), route `showRewardedAd` through
   Bridge with pause/resume of sound+sim around it, swap the `backend` object in
   `storage.js:11-26` to Bridge storage, and use Bridge language detection
   (or declare EN-only). Touches: `index.html` or `package.json`,
   `src/platform/ads.js`, `src/platform/storage.js`, `src/main.js`.
6. **YouTube build target without Bridge** — a second Vite config/alias that
   keeps the current local `ads.js`/`storage.js` so the YouTube bundle has zero
   external calls while the Playgama bundle ships Bridge. Touches: `vite/`,
   possibly `src/platform/` (per-target files).
7. *(Only if targeting those platforms)* Russian localization (VK/Yandex),
   social features/IAP (Facebook/Discord), platform saves (Playdeck) — each is
   its own project; skip unless Playgama proposes those channels.
8. *(Optional, post-launch)* Save-version migrations instead of discarding old
   saves (`storage.js:43`), and consistent `<title>`/store-name alignment.

## MANUAL CHECK LIST (copy-paste test checklist)

```
DEVICE / COMPAT
[ ] Oldest target Android + iPhone: game boots (WebGL2 present), no black page,
    no WebGL error text visible on open
[ ] Low-end Android: FPS acceptable with 5 pits + market + gas station running
[ ] Desktop: Chrome, Firefox, Safari, Edge, Opera — boot, play 5 min each

DISPLAY / UI
[ ] Portrait phone (~360×780): HUD, Upgrades tab, Settings tab, tablet menu,
    tutorial bubbles all visible, nothing cut off or overlapping, no black bars
[ ] Landscape phone (~780×360): same checks; rotate mid-game — no distortion,
    progress intact after rotation
[ ] Desktop window resize (very wide, very tall, tiny): no deformation,
    no scrollbars, canvas always fills window
[ ] Every popup (Settings, Tablet, Break panel, Truck panel, tutorial finale)
    closes via its ✕ / tap
[ ] Play one-handed (thumb only) through the tutorial

SOUND
[ ] First load with no interaction: does audio start only after first tap?
    (Chrome + Safari autoplay policies)
[ ] Minimize tab / switch app: ALL sound stops (currently expected to FAIL)
[ ] Mute control silences music + ambience + hammer/money/bag/door SFX
    (currently expected to FAIL — music slider only)

SAVE / SESSION
[ ] Play 3 min, reload: state restored, offline-earnings popup sane
[ ] Rotate device / kill+reopen browser: ≤5 s of progress lost
[ ] 30+ min soak session: no crash, freeze, console errors, memory creep

CONTENT / LEGAL
[ ] Written license/receipt on file for every GLB pack, all 10 MP3s, and the
    Montserrat font (OFL text kept)
[ ] Game title in store draft matches in-game title
[ ] Confirm no existing Playgama/YouTube catalog title is confusingly similar

PACING (YouTube ≥10 min)
[ ] Time a fresh player (no hints) from boot to tutorial completion — target
    8–15 min, and confirm the 25-manual-repairs opener doesn't cause quits
[ ] Confirm loading-to-playable under 5 s on 10 Mbps (CrazyGames/Facebook also
    care); note the 4.7 MB of music downloading in the background

ADS (after Bridge integration)
[ ] Each of the 3 rewarded buttons: real ad plays, game+sound freeze during it,
    reward granted after, progress saved if the tab is killed mid-ad
```
