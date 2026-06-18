/**
 * Bay.js — pure data model for a repair bay. Holds (at most) one car.
 * Logical only; the scene decides where a bay is drawn.
 */
export class Bay {
  constructor(id, car = null) {
    this.id = id;
    this.car = car;
  }
}
