# Garage 3D — isometric low-poly car-mechanic idle (Three.js + Vite)

Run a car-repair garage from an isometric 3D view. Walk a rigged low-poly
character around with an on-screen joystick; broken cars drive in and queue up,
you (or hired workers) repair them for cash, and you reinvest in more pits,
faster workers, and advertising. Cars and characters are glTF models; the
garage, pits and props are Three.js primitives.

## Run
```bash
npm install
npm run dev      # http://localhost:8080
npm test         # core logic tests (pure Node, no Three.js)
npm run build    # -> /dist (terser-minified)
```

> **Before shipping:** every `upgrades.*.baseCost` and `reputation.adBaseCost`
> in `src/config/settings.js` is slashed to `1` for cheap iteration (marked
> `// TESTING`, originals commented inline). Restore them first.

## Gameplay loop
- Broken cars spawn on a timer into a shared lane queue and route into the
  lowest-index free **pit**. Each car has 1–3 damaged parts; repair is counted
  in *ticks* (`ticksPerPart × parts`) and pays out per part.
- **Repair** a car by tapping it while standing at its pit, or **hire a worker**
  for that pit so it auto-repairs hands-free. Tapping a manned pit's car sends a
  remote **hurry** that briefly speeds its worker.
- Spend cash on upgrades (the in-world computer / DOM menus): **Expand Room** →
  **Buy Pit Equipment** to open more pits, **Hire Worker / Worker Speed /
  Fixing Time** per pit, and **Buy Advertising** to raise **reputation** — the
  chance an incoming car is a higher-paying "better" car. A rewarded ad
  temporarily doubles reputation.
- Progress auto-saves to `localStorage`; reload resumes exactly where you left
  off (no offline-earnings catch-up).

## Architecture

Three strictly-separated layers. The cardinal rule: **`src/core/**` is pure and
holds zero Three.js** — it runs and is tested under plain Node. The scene layer
renders core state and forwards input but **owns no game logic**.

```
src/
├── config/
│   └── settings.js     ← every tunable: speeds, costs, world bounds, pit layout,
│                         reputation, model fixups, colors (hex ints). No Three.
├── core/               ← pure logic, NO Three.js (runnable/testable in Node)
│   ├── GameState.js    ← root state: cash, pits[], carQueue, player, input, reputation
│   ├── simulation.js   ← tick(state,dt), tapRepair, hurry: movement + spawning +
│   │                     queue→pits + workers' auto-repair
│   ├── Car.js          ← spawnCar: randomized damage + reputation "better" tier; id seeding
│   ├── upgrades.js     ← purchases, derived per-pit effects, land fence, menu view model
│   ├── reputation.js   ← effective reputation, Buy Advertising, rewarded-ad boost timer
│   └── format.js       ← formatMoney (K/M/B/T)
├── scene/              ← Three.js; renders core state, owns no game logic
│   ├── SceneManager.js ← renderer, isometric ortho camera, lights, resize, move-basis
│   ├── Input.js        ← bottom-center virtual joystick (Pointer Events)
│   ├── CharacterModel.js / Character.js / Mechanic.js / characterAnim.js
│   │                     ← rigged glTF loaded once + cloned (player + workers); anim crossfades
│   ├── CarView.js / CarYard.js / PitView.js
│   │                     ← car glb loaded once + cloned; pits, queue, drive tweens, tap raycast
│   ├── Garage.js / Computer.js ← static world + the advertising terminal prop
│   └── Hud.js / UpgradeMenu.js / AdvertisingMenu.js / popup.js ← DOM UI overlays
├── platform/           ← swappable host integrations (isolated for porting)
│   ├── storage.js      ← versioned save/load behind a backend abstraction (localStorage)
│   └── ads.js          ← showRewardedAd (stubbed to succeed immediately)
└── main.js             ← bootstrap + RAF loop
```

### How the layers talk
- `Input` exposes a **screen-space** joystick vector (`{x, y}`, up = positive).
- `main.js` maps it to a **camera-relative world** direction via the ground
  basis from `SceneManager` (so "up" on the stick is always "up the screen"),
  then writes `state.input`.
- `simulation.tick(state, dt)` is the only place core state advances: it
  integrates movement (clamped to the owned-land fence), spawns and queues cars,
  feeds free pits, and runs each hired worker's auto-repair.
- The scene reads state to render, and writes back exactly one thing:
  `pit.playerPresent` (per-frame proximity), which core only ever reads.
- Canvas taps raycast pit cars: a manned pit → remote `hurry`; an unmanned
  equipped pit you're standing at → `tapRepair`.

### Camera
Orthographic at equal x/y/z (≈35.26° down, 45° rotation = classic isometric),
framed to a fixed vertical `viewSize` so it scales to any screen. Tune
`settings.camera.viewSize` to zoom and `settings.world.halfX/halfZ` for room
size. Pit positions step z opposite to x so a row reads side-by-side on screen.

### Extending
Add gameplay in `core/` + `settings.js`; the renderer keeps working as long as
it reads state. Drop new props/views into `scene/`. Swapping the host platform
(storage, ads) should only touch `platform/`.
