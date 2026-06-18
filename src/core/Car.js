/**
 * Car.js — pure data model for a single car. No Phaser, no rendering.
 */
import balance from '../config/balance.js';

let nextCarId = 1;

export class Car {
  constructor({ totalWork, payout, damage }) {
    this.id = nextCarId++;
    this.totalWork = totalWork;
    this.repairWork = 0;
    this.payout = payout;
    // Clone the damage definitions so each car owns its own marker state.
    this.damage = damage.map((d) => ({ ...d, cleared: false }));
  }

  /** Repair completion as a 0..1 fraction. */
  get progress() {
    return this.totalWork <= 0 ? 1 : this.repairWork / this.totalWork;
  }

  get isFixed() {
    return this.repairWork >= this.totalWork;
  }
}

/** Factory that stamps out a fresh broken car from the balance config. */
export function createCar() {
  return new Car({
    totalWork: balance.car.totalWork,
    payout: balance.car.payout,
    damage: balance.car.damage,
  });
}
