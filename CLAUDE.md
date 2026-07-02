# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev      # Vite dev server at http://localhost:8080 (vite/config.dev.mjs)
npm run build    # production build -> /dist (terser-minified, vite/config.prod.mjs)
npm test         # node test/core.test.mjs — core logic only, no Three.js needed
```

There is no lint step and no test framework. `test/core.test.mjs` is a single
zero-dependency Node script with a hand-rolled `check(name, fn)` helper. To run
"one test", comment out the others or temporarily edit the file — they are plain
function calls, not registered cases. Tests only exercise `src/core/**` and
`src/config/settings.js`; the Three.js scene layer is intentionally untested.

## Architecture

Three strictly-separated layers. The cardinal rule: **`src/core/**` is pure and
contains zero Three.js** — it runs and is tested under plain Node. The scene
layer renders core state and forwards input but **owns no game logic**.

```
src/
├── config/settings.js   single source of every tunable (speeds, costs, world
│                         bounds, colors as hex ints, pit positions, model fixups).
│                         No Three.js imports — colors are plain ints/CSS strings.
├── core/                pure logic, Node-runnable/testable, NO Three.js:
│   ├── GameState.js      root state shape (cash, pits[], carQueue, player, input,
│   │                     reputation). All mutation goes through other core modules.
│   ├── simulation.js     tick(state, dt), tapRepair(state, i), hurry(state, i).
│   │                     tick = movement + spawning + queue→pits + workers' auto-repair.
│   ├── Car.js            spawnCar(state): randomized damage + reputation tier; id seeding.
│   ├── upgrades.js       all purchases + derived per-pit effects (workerSpeed,
│   │                     requiredTicks, ownedRightX/fence) + the Upgrades menu view model.
│   ├── reputation.js     effective reputation, Buy Advertising, rewarded-ad boost timer.
│   ├── supermarket.js    shop sim: customers, market worker FSM, restock box + truck.
│   ├── breaks.js         per-worker break clocks (job counts, durations, ad wake-up).
│   ├── collision.js      shared AABB obstacle list + circle push-out (player/mechanic).
│   ├── pathfinding.js    static A* walkability grid + findPath for market NPCs.
│   └── format.js         formatMoney (K/M/B/T at 3 sig figs).
├── scene/               Three.js render layer (reads core state, writes nothing
│                         to game logic except per-frame proximity flags):
│   ├── SceneManager.js   renderer, isometric ortho camera, lights, resize, moveBasis.
│   ├── Input.js          bottom-center virtual joystick (Pointer Events).
│   ├── CharacterModel.js loads + merges the rigged glTF clips ONCE.
│   ├── Character.js / Mechanic.js / characterAnim.js  player + worker NPCs (clone the
│   │                     shared gltf; crossfade idle/walk/repair/yell from core flags).
│   ├── CarView.js        preloads the car glb once, cloned per car.
│   ├── CarYard.js / PitView.js  the pits, queued cars, drive tweens, tap raycasting.
│   ├── Garage.js         static world: floor, walls, doors, exterior roads.
│   ├── SupermarketView.js / MarketWorker.js / MarketCustomer.js / Cashier.js /
│   │   TruckView.js      the shop's render layer (mirrors state.supermarket).
│   ├── StorageModels.js / CarriedBox.js / PitMoney.js  prop glbs (load-once + clone).
│   └── Hud.js / UpgradeMenu.js / BreakMenu.js / TruckMenu.js / popup.js  DOM UI overlays.
├── platform/            swappable host integrations (isolated for the Playgama port):
│   ├── storage.js        save/load behind a `backend` abstraction (localStorage today).
│   └── ads.js            showRewardedAd — stubbed to succeed immediately.
└── main.js              bootstrap + requestAnimationFrame loop.
```

### Frame loop contract (`main.js`)
Every frame, in order:
1. Read screen-space joystick (`input.value`), map it through `SceneManager.moveBasis`
   (camera-relative ground axes) into a **world-space** direction, write `state.input`.
2. `tick(state, dt)` then `tickSupermarket(state, dt)` — the only places core
   state advances (dt clamped to 0.05 to absorb tab-switch jumps).
3. Scene writes `pit.playerPresent` from proximity to `settings.pit.positions` — the
   one piece of state the render layer pushes back into core (core only reads it).
4. Update each view from state, then `sceneManager.render()`.

Canvas taps raycast the pit cars: a manned pit's car → remote `hurry` (works from
anywhere); an unmanned equipped pit's car → `tapRepair` (only while `playerPresent`).

### Key invariants
- **Geometric costs**: every upgrade/ad cost is `Math.round(baseCost × growth^level)`.
  Don't flatten `costGrowth` to 1 — `Math.round` then breaks the strict-increase tests.
- **Two-stage pit unlock**: `roomUnlocked` (Expand Room reveals empty floor + slides
  the land fence right) then `equipped` (Buy Pit Equipment; only equipped pits accept
  cars / allow hiring). Pit 0 starts both. `maxPits` = 5, one per car tier — a
  spawned car routes to the pit matching its reputation tier and is discarded if
  that pit can't take it.
- **glTF loaded once, cloned**: the character model (player + every worker) and the car
  model are each loaded a single time and cloned; never re-load per instance.
- **Save format is versioned**: `storage.js` carries `SAVE_VERSION`; a mismatch
  discards the save. There is no offline-earnings catch-up — reload restores state as-is.

### Tuning notes
- Camera framing & room size are tuned by eye: `settings.camera.viewSize` (zoom),
  `settings.world.halfX/halfZ` (room), `settings.pit.positions` (laid out so a
  pure-x row reads diagonally on the isometric camera).
- glTF `modelScale` / `modelYRotationOffset` in `settings.character` and `settings.car`
  correct source-file scale/facing; `settings.character.animationMap` maps logical
  states to clip names (falls back to clip 0 with a warn, so a wrong name never freezes).

### ⚠️ Before shipping
`settings.upgrades.*.baseCost` and `reputation.adBaseCost` are all slashed to `1` for
cheap iteration (marked `// TESTING` with the original values commented inline). Restore
them before release.
