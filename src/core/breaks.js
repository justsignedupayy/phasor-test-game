/**
 * breaks.js — every worker's break clock, pure logic, no Three.js.
 *
 * Every worker (each pit mechanic + the market worker) tracks its own job
 * counter. After enough completed jobs it goes on break: it finishes its
 * current task, walks to its wall-side break spot, and leans there for
 * breakDuration() seconds, then resumes automatically. The only early wake-up
 * is a rewarded ad (endBreak).
 *
 * The break state is a small plain object stored ON the worker's entity (a pit
 * for a mechanic, state.supermarket.worker for the market worker), so it rides
 * the existing save serialization for free — see GameState.createPit and
 * supermarket.createMarketWorker.
 *
 *   createBreakState(kind)    fresh counter for a 'carMechanic' | 'marketWorker'
 *   incrementJobCount(b)      +1 job; trips the break once the threshold is hit
 *   tickBreak(b, dt, state)   advance a running break; auto-ends it when elapsed
 *   endBreak(b)               clear the break (timer expiry or an ad reward)
 *   breakDuration(b, state)   seconds this break lasts (shortened by upgrades)
 *   breakRemaining(b, state)  seconds left on a running break (0 when not on one)
 *
 * `state` is optional everywhere it appears: it supplies the owned per-worker-
 * type "Shorter Breaks" level (state.breakLevels, bought in upgrades.js —
 * each level halves the duration); without it the base duration applies.
 */
import settings from '../config/settings.js';

/** A fresh break counter. `kind` selects the threshold (settings.breakThresholds).
 * The optional overrides apply to the very FIRST break only (used by pit A's
 * mechanic, see GameState.createPit): `firstThreshold` makes it trip at that
 * count (cleared when it trips), `firstDuration` makes it last that many
 * seconds (cleared when it ends) — every later cycle uses the kind's shared
 * threshold and the normal upgrade-scaled duration. */
export function createBreakState(kind, firstThreshold = null, firstDuration = null) {
  return {
    kind, // 'carMechanic' | 'marketWorker'
    jobCount: 0,
    onBreak: false,
    breakTimer: 0, // seconds elapsed on the current break
    firstThreshold, // one-time first-break trip-count override; null = none
    firstDuration, // one-time first-break length override (seconds); null = none
  };
}

/** Jobs this worker completes before earning a break. */
export function breakThreshold(b) {
  return b.firstThreshold ?? settings.breakThresholds[b.kind];
}

/** Break length (seconds) at a given "Shorter Breaks" level — each level halves it. */
export function breakDurationAtLevel(level) {
  return settings.breakDurations.base / 2 ** level;
}

/** How long this worker's break lasts, honouring the owned upgrade level —
 * except a pending one-time first-break override, which applies flat. */
export function breakDuration(b, state) {
  return b.firstDuration ?? breakDurationAtLevel(state?.breakLevels?.[b.kind] ?? 0);
}

/** Seconds left on a running break (0 when not on one). */
export function breakRemaining(b, state) {
  return b.onBreak ? Math.max(0, breakDuration(b, state) - b.breakTimer) : 0;
}

/**
 * Count one finished job. Already-on-break workers don't accrue jobs (they
 * aren't working). Reaching the threshold trips the break and zeroes the count.
 */
export function incrementJobCount(b) {
  if (b.onBreak) return;
  b.jobCount += 1;
  if (b.jobCount >= breakThreshold(b)) {
    b.onBreak = true;
    b.breakTimer = 0;
    b.jobCount = 0;
    b.firstThreshold = null; // the one-time first-break override is spent
  }
}

/** Advance a running break; auto-ends it once the full duration has elapsed. */
export function tickBreak(b, dt, state) {
  if (!b.onBreak) return;
  b.breakTimer += dt;
  if (b.breakTimer >= breakDuration(b, state)) endBreak(b);
}

/** End the break now (timer expiry or a rewarded-ad wake-up). Counter resets to 0. */
export function endBreak(b) {
  if (b.onBreak) b.firstDuration = null; // an ended break was the first — its one-time duration is spent
  b.onBreak = false;
  b.breakTimer = 0;
  b.jobCount = 0;
}
