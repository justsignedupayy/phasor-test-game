# Garage 3D — isometric low-poly idle (Three.js + Vite)

Vertical slice: walk a low-poly character around an isometric 3D garage with an
on-screen joystick. Movement-feel only — no gameplay yet. All geometry is
primitives (boxes, cylinders, spheres, cones, planes); no model files or textures.

## Run
```bash
npm install
npm run dev      # http://localhost:8080
npm test         # core logic tests, no Three.js needed
npm run build    # -> /dist
```

## Architecture

Game logic is pure and Three.js-free; the render layer reads core state and
forwards input. It never owns game logic.

```
src/
├── config/
│   └── settings.js     ← every tunable: move speed, camera, world bounds, bob, colors
├── core/               ← pure logic, NO Three.js (runnable/testable in Node)
│   ├── GameState.js    ← cash, pits (later), player {position, rotation, moving}, input
│   └── simulation.js   ← tick(state, dt): integrates movement, clamps to bounds
├── scene/              ← Three.js; renders core state, owns no game logic
│   ├── SceneManager.js ← renderer, isometric ortho camera, lights, resize, move-basis
│   ├── Input.js        ← bottom-center virtual joystick (touch + mouse, Pointer Events)
│   ├── Character.js    ← low-poly figure from primitives; idle/walk bob, facing
│   ├── Garage.js       ← floor, grid, low walls, repair-pit patch
│   └── BrokenCar.js    ← parked broken-car prop (set dressing)
└── main.js             ← bootstrap + RAF loop: input → tick(state,dt) → render
```

### How the layers talk
- `Input` exposes a **screen-space** joystick vector (`{x, y}`, up = positive).
- `main.js` maps it to a **camera-relative world** direction using the ground
  basis from `SceneManager` (so "up" on the stick always means "up the screen"),
  then writes it to `state.input`.
- `simulation.tick(state, dt)` integrates `state.input` into `player.position`,
  clamps to `world` bounds, and sets `player.rotation` to face movement.
- `Character.update(dt, player)` reads that state and animates via transforms
  (smoothed turn, idle/walk bob, limb swing). No skeletal rigging.

### Camera
Orthographic, positioned at equal x/y/z (≈35.26° down, 45° rotation = classic
isometric), framed to a fixed vertical `viewSize` so it scales to any screen.
Tune `settings.camera.viewSize` to zoom; `settings.world.half{X,Z}` for room size.

### Extending
Add repairs/economy/pits in `core/` + `settings.js`; the renderer keeps working
as long as it reads state. Drop new props into `scene/`.

## Note
Camera framing and world size are tuned by eye in `settings.js` — adjust
`camera.viewSize` and `world.halfX/halfZ` to taste.
