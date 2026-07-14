import settings from '../config/settings.js';

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

export function breakThresholdAtLevel(kind, level) {
  return settings.breakThresholds[kind] * 2 ** level;
}

export function breakThreshold(b, state) {
  return b.firstThreshold ?? breakThresholdAtLevel(b.kind, state?.breakThresholdLevels?.[b.kind] ?? 0);
}

export function breakDurationAtLevel(level) {
  return settings.breakDurations.base / 2 ** level;
}

export function breakDuration(b, state) {
  return b.firstDuration ?? breakDurationAtLevel(state?.breakLevels?.[b.kind] ?? 0);
}

export function breakRemaining(b, state) {
  return b.onBreak ? Math.max(0, breakDuration(b, state) - b.breakTimer) : 0;
}

export function incrementJobCount(b, state) {
  if (b.onBreak) return;
  b.jobCount += 1;
  if (b.jobCount >= breakThreshold(b, state)) {
    b.onBreak = true;
    b.breakTimer = 0;
    b.jobCount = 0;
    b.firstThreshold = null; // the one-time first-break override is spent
  }
}

export function tickBreak(b, dt, state) {
  if (!b.onBreak) return;
  b.breakTimer += dt;
  if (b.breakTimer >= breakDuration(b, state)) endBreak(b);
}

export function endBreak(b) {
  if (b.onBreak) b.firstDuration = null; // an ended break was the first — its one-time duration is spent
  b.onBreak = false;
  b.breakTimer = 0;
  b.jobCount = 0;
}
