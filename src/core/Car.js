/**
 * Car.js — pure car model + factory. No Three.js.
 *
 * spawnCar() picks a random non-empty subset of the damage parts (kept in
 * canonical order so the render and the per-part thresholds line up). Repair is
 * counted in ticks: baseTicks = ticksPerPart × numParts. The pit's fixing-time
 * upgrade later scales how many of those ticks are actually required. Payout
 * scales with the number of parts so value-per-tick stays ~constant.
 */
import settings from '../config/settings.js';

const ALL_PARTS = ['tire', 'smoke', 'dent'];
let nextId = 1;

export function spawnCar() {
  const parts = ALL_PARTS.filter(() => Math.random() < 0.5);
  if (parts.length === 0) {
    parts.push(ALL_PARTS[Math.floor(Math.random() * ALL_PARTS.length)]);
  }
  const n = parts.length;

  return {
    id: nextId++,
    baseTicks: settings.repair.ticksPerPart * n, // before the pit's fixTimeFactor
    ticksDone: 0,
    damageParts: parts, // subset of ALL_PARTS, canonical order
    payout: settings.spawn.basePayoutPerPart * n,
    fixed: false,
  };
}
