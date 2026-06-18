# Garage Idle — car-mechanic idle game (Phaser 3 + Vite)

Vertical slice: tap a broken car to repair it, get paid, next car rolls in. Built
for YouTube Playables (via Playgama Bridge), but the game logic is fully
framework-agnostic.

## Run
```bash
npm install
npm run dev      # http://localhost:8080
npm test         # core logic tests, no Phaser needed
npm run build    # -> /dist
```

## Architecture

Game logic is pure and Phaser-free; Phaser only renders state and forwards input.

```
src/
├── config/
│   └── balance.js     ← every tunable number (totalWork, payout, tapValue, mechanicRate…)
├── core/              ← pure logic, NO Phaser imports (runnable/testable in Node)
│   ├── Car.js         ← car model + createCar() factory
│   ├── Bay.js         ← repair-bay model (holds one car)
│   ├── GameState.js   ← cash + bays; createInitialState()
│   └── simulation.js  ← tick(state, dt) + tapBay(state, bayId); returns events
├── scenes/            ← Phaser; renders core state, forwards taps, owns no logic
│   ├── Boot.js        ← Playgama Bridge init, then starts Game
│   └── GameScene.js   ← HUD + bay rendering; calls tick()/tapBay(); reacts to events
├── bridge/
│   └── Bridge.js      ← Playgama Bridge wrapper (platform integration)
└── main.js            ← Phaser game config (540×960 portrait, FIT scale)
```

### How the layers talk
- `simulation.js` mutates `GameState` and **returns an event list** (`damageCleared`,
  `carFixed`, `carSpawned`).
- `GameScene` reads `GameState` each frame for persistent visuals (cash, car heal
  color) and consumes events for transient effects (marker pop, slide-off, `+$15`).
- `GameScene.update()` calls `tick(state, dt)` every frame. With `mechanic.rate = 0`
  it does nothing yet — it's wired so auto-progress / mechanics drop in cleanly.

### Extending
Add upgrades, more bays, or auto-mechanics by editing `core/` + `balance.js`; the
renderer keeps working as long as it reads state and handles the same events.

## SDK Docs
- Playgama Bridge: https://wiki.playgama.com/playgama/bridge-sdk/getting-started
- YouTube Playables: https://developers.google.com/youtube/gaming/playables
