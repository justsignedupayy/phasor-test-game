/**
 * storage.js — save/load persistence behind a small backend abstraction, so
 * step 8 can swap in Playgama's storage by changing only `backend` below.
 * Default backend: localStorage. The save payload carries a saveVersion so a
 * future format change can migrate or safely discard old saves.
 */
const SAVE_KEY = 'garageIdleSave';
const MUSIC_VOLUME_KEY = 'garageIdleMusicVolume'; // own key: device preference, survives SAVE_VERSION bumps
const MUTED_KEY = 'garageIdleMuted'; // own key like the volume: device preference, survives SAVE_VERSION bumps
const SAVE_VERSION = 20; // v20: tutorial 'firstBreak' moved BEFORE 'firstRestock' (it now showcases pit A's special early first break) + state.tutorial.firstBreakEverStarted latch, swapping those step indices; v19: tutorial gained a 'firstPendingCash' step between breakLed and firstRestock, shifting every later step index; v18: tutorial reworked — repairsRemaining now counts COMPLETED manual repairs (was per-tap repairTapsRemaining) and four steps were inserted (breakLed/firstRestock/firstBreak/truckLed), shifting every step index; v17: mandatory first-game tutorial state (state.tutorial — see core/tutorial.js); v16: save payload now carries savedAt (Date.now() at save time), read by getSavedAt() for the offline-earnings estimate on next load; v15: Watch Ad now grants PERMANENT +rep with a cooldown (state.adCooldownRemaining replaces the removed temporary state.repBoostRemaining); v14: per-worker-type "Shorter Breaks" levels (state.breakLevels) + one-time Player Speed purchase (state.playerSpeedBought); v13: order-based truck (supermarket.truckOrdered; truckTimer now counts a placed order's wait, not an automatic arrival clock); v12: gas station starts fully locked + per-pump attendant break state (pump.break); v11: gas station (state.gasStation: pumps/attendants/spawnTimer); v10: conveyor replaced by mechanic auto-restock (state.autoRestock + per-pit core mechanic; removed hasConveyor/conveyorTimer/conveyorBounds); v9: restock box moved to the front-wall delivery dock (saved restockBoxPosition); v8: supermarket restock box (limited units) + delivery truck (timer/upgrade); v7: per-worker break state (pit.break / worker.break); v6: supermarket (shelves/customers/worker); v5: per-pit tires/shelf + conveyor + carried box; v4: pendingCash + cashier; v3: 5 pits

const backend = {
  read(key = SAVE_KEY) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // storage unavailable (private mode, disabled, etc.)
    }
  },
  write(raw, key = SAVE_KEY) {
    try {
      localStorage.setItem(key, raw);
    } catch {
      // storage unavailable or quota exceeded — drop the save silently
    }
  },
};

export function saveGame(state) {
  backend.write(JSON.stringify({ saveVersion: SAVE_VERSION, savedAt: Date.now(), state }));
}

function readValidPayload() {
  const raw = backend.read();
  if (!raw) return null;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!payload || payload.saveVersion !== SAVE_VERSION) return null;
  return payload;
}

/** Returns the saved GameState-shaped object, or null if there's no valid save. */
export function loadGame() {
  return readValidPayload()?.state ?? null;
}

/** Returns the saved payload's savedAt timestamp (ms), or null if there's no valid save. */
export function getSavedAt() {
  return readValidPayload()?.savedAt ?? null;
}

const DEFAULT_MUSIC_VOLUME = 0.5;

/** Returns the persisted music volume in [0, 1], or the default if unset/invalid. */
export function loadMusicVolume() {
  const v = Number.parseFloat(backend.read(MUSIC_VOLUME_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_MUSIC_VOLUME;
}

export function saveMusicVolume(volume) {
  backend.write(String(volume), MUSIC_VOLUME_KEY);
}

/** Returns the persisted global-mute flag (false if unset). */
export function loadMuted() {
  return backend.read(MUTED_KEY) === '1';
}

export function saveMuted(muted) {
  backend.write(muted ? '1' : '0', MUTED_KEY);
}
