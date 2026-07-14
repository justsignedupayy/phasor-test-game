// One-time standalone hints — same look as the tutorial, but fully outside its
// step sequence: they never gate, block, or advance a tutorial step, and each
// fires once off its own trigger, latched in state.hints (persisted with the save).
import settings from '../config/settings.js';

export function createHintsState() {
  return {
    breakRepairLive: false, // pit A's first NORMAL break is up and the hint is on screen
    breakRepairShown: false, // latched forever once that break ends — the hint never repeats
  };
}

// The special early first break (5 jobs / 30s) carries its one-time firstDuration
// override until it ends, so a NORMAL break is simply one without it.
function pitAOnNormalBreak(state) {
  const pit = state.pits[0];
  return pit.hasMechanic && pit.break.onBreak && pit.break.firstDuration == null;
}

export function tickHints(state) {
  const h = state.hints;
  if (!h || h.breakRepairShown) return;
  if (pitAOnNormalBreak(state)) {
    h.breakRepairLive = true;
  } else if (h.breakRepairLive) {
    h.breakRepairLive = false;
    h.breakRepairShown = true; // the break it rode on is over — spent for good
  }
}

export function getHintView(state) {
  const h = state.hints;
  if (!h || h.breakRepairShown || !h.breakRepairLive) return null;
  const spot = settings.breaks.breakSpots[0]; // where the resting mechanic sits
  return {
    id: 'breakRepairHint',
    text: 'Your worker is on a break — but you can still walk up and tap the car to repair it yourself until they return!',
    anchor: { kind: 'world', x: spot.x, z: spot.z },
  };
}
