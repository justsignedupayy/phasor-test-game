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
 *   tickBreak(b, dt)          advance a running break; auto-ends it when elapsed
 *   endBreak(b)               clear the break (timer expiry or an ad reward)
 *   breakDuration(b)          seconds this break lasts
 *   breakRemaining(b)         seconds left on a running break (0 when not on one)
 */
import settings from '../config/settings.js';

/** A fresh break counter. `kind` selects the threshold (settings.breakThresholds). */
export function createBreakState(kind) {
  return {
    kind, // 'carMechanic' | 'marketWorker'
    jobCount: 0,
    onBreak: false,
    breakTimer: 0, // seconds elapsed on the current break
  };
}

/** Jobs this worker completes before earning a break. */
export function breakThreshold(b) {
  return settings.breakThresholds[b.kind];
}

/** How long this worker's break lasts. */
export function breakDuration(b) {
  return settings.breakDurations.base;
}

/** Seconds left on a running break (0 when not on one). */
export function breakRemaining(b) {
  return b.onBreak ? Math.max(0, breakDuration(b) - b.breakTimer) : 0;
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
  }
}

/** Advance a running break; auto-ends it once the full duration has elapsed. */
export function tickBreak(b, dt) {
  if (!b.onBreak) return;
  b.breakTimer += dt;
  if (b.breakTimer >= breakDuration(b)) endBreak(b);
}

/** End the break now (timer expiry or a rewarded-ad wake-up). Counter resets to 0. */
export function endBreak(b) {
  b.onBreak = false;
  b.breakTimer = 0;
  b.jobCount = 0;
}
