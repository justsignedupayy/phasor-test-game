/**
 * storage.js — save/load persistence behind a small backend abstraction.
 * Default backend: localStorage; at boot main.js may swap in a Bridge-backed
 * one via setStorageBackend (built by #bridge's createBridgeStorageBackend —
 * this file deliberately never imports Bridge so it stays Node-testable).
 * The save payload carries a saveVersion so a future format change can
 * migrate or safely discard old saves.
 */
const SAVE_KEY = 'garageIdleSave';
const MUSIC_VOLUME_KEY = 'garageIdleMusicVolume'; // own key: device preference, survives SAVE_VERSION bumps
const MUTED_KEY = 'garageIdleMuted'; // own key like the volume: device preference, survives SAVE_VERSION bumps
export const SAVE_VERSION = 20; // v20: tutorial 'firstBreak' moved BEFORE 'firstRestock' (it now showcases pit A's special early first break) + state.tutorial.firstBreakEverStarted latch, swapping those step indices; v19: tutorial gained a 'firstPendingCash' step between breakLed and firstRestock, shifting every later step index; v18: tutorial reworked — repairsRemaining now counts COMPLETED manual repairs (was per-tap repairTapsRemaining) and four steps were inserted (breakLed/firstRestock/firstBreak/truckLed), shifting every step index; v17: mandatory first-game tutorial state (state.tutorial — see core/tutorial.js); v16: save payload now carries savedAt (Date.now() at save time), read by getSavedAt() for the offline-earnings estimate on next load; v15: Watch Ad now grants PERMANENT +rep with a cooldown (state.adCooldownRemaining replaces the removed temporary state.repBoostRemaining); v14: per-worker-type "Shorter Breaks" levels (state.breakLevels) + one-time Player Speed purchase (state.playerSpeedBought); v13: order-based truck (supermarket.truckOrdered; truckTimer now counts a placed order's wait, not an automatic arrival clock); v12: gas station starts fully locked + per-pump attendant break state (pump.break); v11: gas station (state.gasStation: pumps/attendants/spawnTimer); v10: conveyor replaced by mechanic auto-restock (state.autoRestock + per-pit core mechanic; removed hasConveyor/conveyorTimer/conveyorBounds); v9: restock box moved to the front-wall delivery dock (saved restockBoxPosition); v8: supermarket restock box (limited units) + delivery truck (timer/upgrade); v7: per-worker break state (pit.break / worker.break); v6: supermarket (shelves/customers/worker); v5: per-pit tires/shelf + conveyor + carried box; v4: pendingCash + cashier; v3: 5 pits

/** Every key this module persists — a swapped-in backend must hydrate all of
 * them up front, because read() below is synchronous (boot-time loads can't
 * await). */
export const PERSISTED_KEYS = [SAVE_KEY, MUSIC_VOLUME_KEY, MUTED_KEY];

const localBackend = {
  read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // storage unavailable (private mode, disabled, etc.)
    }
  },
  write(raw, key) {
    try {
      localStorage.setItem(key, raw);
    } catch {
      // storage unavailable or quota exceeded — drop the save silently
    }
  },
  wipe() {
    try {
      localStorage.clear();
    } catch {
      // storage unavailable — nothing persisted to wipe anyway
    }
  },
};

let backend = localBackend;

/** Swap the persistence backend (main.js, after a successful Bridge storage
 * hydration). Shape: { read(key)->string|null, write(raw, key), wipe() } —
 * read must be synchronous over pre-hydrated data. */
export function setStorageBackend(b) {
  backend = b;
}

// Latched by wipeSave (the debug Reset): once the save is deliberately
// cleared, every later saveGame is a no-op. The page is about to reload, and
// any straggler write in between would silently resurrect the wiped save —
// location.reload() fires visibilitychange (hidden) DURING its unload phase,
// which main.js answers with a save-on-hide.
let saveWiped = false;

export function saveGame(state) {
  if (saveWiped) return;
  backend.write(JSON.stringify({ saveVersion: SAVE_VERSION, savedAt: Date.now(), state }), SAVE_KEY);
}

/**
 * Debug Reset: clear EVERY persisted key (save + audio preferences, matching
 * the old `localStorage.clear()` behavior) and block all further saveGame
 * writes until the caller's reload lands on a fresh page.
 */
export function wipeSave() {
  saveWiped = true;
  backend.wipe();
}

/**
 * Stepwise save migrations: MIGRATIONS[n] upgrades a version-n payload IN
 * PLACE to version n+1. migratePayload walks a payload forward one step at a
 * time until it reaches SAVE_VERSION; a version with no registered step (or a
 * payload from a NEWER build) returns null and the save is discarded — the
 * pre-migration behavior. Register a step here for every future version bump
 * so shipped players stop losing progress on updates.
 */
const MIGRATIONS = {
  // v19 → v20: the tutorial's 'firstBreak' and 'firstRestock' steps swapped
  // list positions (indexes 5/6 — firstBreak now showcases pit A's special
  // early first break), and tutorial state gained the firstBreakEverStarted
  // latch. Remapping the index preserves the step the player was actually on;
  // the latch starts false (worst case: an already-past first break makes the
  // step wait for the next live one, exactly the old behavior).
  19: (payload) => {
    const t = payload.state?.tutorial;
    if (t && t.active) {
      if (t.step === 5) t.step = 6;
      else if (t.step === 6) t.step = 5;
    }
    if (t) t.firstBreakEverStarted = t.firstBreakEverStarted ?? false;
  },
};

/** Walk a payload forward to SAVE_VERSION, or null if no path exists. Pure —
 * exported for the Node test suite. */
export function migratePayload(payload) {
  if (!payload || typeof payload.saveVersion !== 'number') return null;
  while (payload.saveVersion < SAVE_VERSION) {
    const step = MIGRATIONS[payload.saveVersion];
    if (!step) return null;
    step(payload);
    payload.saveVersion += 1;
  }
  return payload.saveVersion === SAVE_VERSION ? payload : null; // newer-than-us saves are discarded
}

function readValidPayload() {
  const raw = backend.read(SAVE_KEY);
  if (!raw) return null;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  return migratePayload(payload);
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
