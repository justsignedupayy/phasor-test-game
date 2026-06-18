/**
 * GameState.js — the root game state. Holds cash and the array of bays.
 * Pure data; all mutation goes through the simulation module.
 */
import { Bay } from './Bay.js';
import { createCar } from './Car.js';

export class GameState {
  constructor({ cash = 0, bays = [] } = {}) {
    this.cash = cash;
    this.bays = bays;
  }
}

/** Build the starting state: one bay with a fresh broken car. */
export function createInitialState() {
  return new GameState({
    cash: 0,
    bays: [new Bay(1, createCar())],
  });
}
