/**
 * Car.js — pure car model + factory. No Three.js.
 *
 * spawnCar() picks a random non-empty subset of the damage parts (kept in
 * canonical order so the render and the per-part thresholds line up). Work and
 * payout both scale with the number of parts, so value-per-tap stays ~constant.
 */
import settings from '../config/settings.js';

const ALL_PARTS = ['tire', 'smoke', 'dent'];
let nextId = 1;

export function spawnCar(workMult = 1) {
  const parts = ALL_PARTS.filter(() => Math.random() < 0.5);
  if (parts.length === 0) {
    parts.push(ALL_PARTS[Math.floor(Math.random() * ALL_PARTS.length)]);
  }
  const n = parts.length;

  return {
    id: nextId++,
    totalWork: Math.round(settings.spawn.baseWorkPerPart * n * workMult),
    repairWork: 0,
    damageParts: parts, // subset of ALL_PARTS, canonical order
    payout: settings.spawn.basePayoutPerPart * n,
    fixed: false,
  };
}
