/**
 * GameState.js — the root game state. Pure data, no Three.js.
 * All mutation goes through the simulation / upgrades modules.
 */
import settings from '../config/settings.js';

export class GameState {
  constructor() {
    this.cash = 0;

    // Progression.
    this.upgrades = {
      hasMechanic: false,
      workerSpeed: 0,
      fixingTime: 0,
    };
    this.hurryTimer = 0; // seconds of remaining mechanic speed boost

    // Single repair pit. car may be null between cars; `playerPresent` is written
    // by the scene each frame (proximity) and only read by core.
    this.pit = {
      car: null,
      playerPresent: false,
    };

    // Cars waiting in the lane (capped at settings.spawn.maxQueue) and the
    // countdown to the next spawn. Seeded so the first car arrives immediately.
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
