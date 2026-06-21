/**
 * GameState.js — the root game state. Pure data, no Three.js.
 * All mutation goes through the simulation / upgrades modules.
 */
import settings from '../config/settings.js';

/**
 * One repair pit. Two-stage unlock: roomUnlocked (empty floor) then equipped
 * (accepts cars + allows hiring). `car` is null between cars; `playerPresent` is
 * written by the scene each frame (proximity) and only read by core. Derived
 * workerSpeed / fixTimeFactor live in upgrades.js (computed from the levels).
 */
function createPit(index) {
  return {
    index,
    roomUnlocked: index === 0, // pit 0 starts open...
    equipped: index === 0, // ...and equipped; the rest start both false
    car: null,
    hasMechanic: false,
    workerSpeedLevel: 0,
    fixingTimeLevel: 0,
    playerPresent: false,
    hurryTimer: 0, // seconds of remaining worker speed boost (per pit)
  };
}

export class GameState {
  constructor() {
    this.cash = 0;

    // Parallel pits, lowest index first.
    this.pits = Array.from({ length: settings.maxPits }, (_, i) => createPit(i));

    // One shared queue (capped at settings.spawn.maxQueue) and the countdown to
    // the next spawn. Seeded so the first car arrives immediately.
    this.carQueue = [];
    this.spawnTimer = settings.spawn.interval;

    this.player = {
      position: { x: 0, z: 0 },
      rotation: 0, // radians around Y; 0 faces +z
      moving: false,
    };

    // Desired move direction in WORLD space (x/z), magnitude 0..1.
    this.input = { x: 0, z: 0 };
  }
}

export function createInitialState() {
  return new GameState();
}
