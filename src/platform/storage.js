const SAVE_KEY = 'garageIdleSave';
const MUSIC_VOLUME_KEY = 'garageIdleMusicVolume'; // own key: device preference, survives SAVE_VERSION bumps
const MUTED_KEY = 'garageIdleMuted'; // own key like the volume: device preference, survives SAVE_VERSION bumps
const CANARY_KEY = 'garageIdleCanary'; // planted every boot; only a full wipe removes it (see reconcilePlatformReset)
// Bump on any save-shape change AND register a MIGRATIONS step for the old version — no path = save discarded.
export const SAVE_VERSION = 22;

// A swapped-in backend must hydrate every key up front: read() is synchronous.
export const PERSISTED_KEYS = [SAVE_KEY, MUSIC_VOLUME_KEY, MUTED_KEY, CANARY_KEY];

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
    }
  },
  wipe() {
    try {
      localStorage.clear();
    } catch {
    }
  },
};

let backend = localBackend;

export function setStorageBackend(b) {
  backend = b;
}

// Once wiped, block all saves — the reload that follows fires a save-on-hide
// during unload that would otherwise resurrect the wiped save.
let saveWiped = false;

export function saveGame(state) {
  if (saveWiped) return;
  backend.write(JSON.stringify({ saveVersion: SAVE_VERSION, savedAt: Date.now(), canary: true, state }), SAVE_KEY);
}

export function wipeSave() {
  saveWiped = true;
  backend.wipe();
}

// Detects the host's "Reset Progress" (Playgama): it deletes our keys with no
// event, and the dying session's autosaves re-write the save afterwards. Only
// a full wipe removes the canary (saves re-write SAVE_KEY alone), so a
// canary-stamped save WITHOUT its canary key is post-wipe — discard it.
// Unstamped pre-update saves are exempt. Run after backend swap, before loadGame.
export function reconcilePlatformReset() {
  const raw = backend.read(SAVE_KEY);
  let wiped = false;
  if (raw) {
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
    }
    if (payload?.canary === true && backend.read(CANARY_KEY) == null) {
      wiped = true;
      backend.wipe(); // drop the ghost save (and stale prefs) everywhere
    }
  }
  backend.write('1', CANARY_KEY);
  return wiped;
}

const MIGRATIONS = {
  19: (payload) => {
    const t = payload.state?.tutorial;
    if (t && t.active) {
      if (t.step === 5) t.step = 6;
      else if (t.step === 6) t.step = 5;
    }
    if (t) t.firstBreakEverStarted = t.firstBreakEverStarted ?? false;
  },
  20: (payload) => {
    // v21 adds the "Longer Shifts" break-threshold upgrade levels
    const s = payload.state;
    if (s) s.breakThresholdLevels = s.breakThresholdLevels ?? { carMechanic: 0, marketWorker: 0, gasAttendant: 0 };
  },
  21: (payload) => {
    // v22 adds the standalone one-time hints (core/hints.js)
    const s = payload.state;
    if (s) s.hints = s.hints ?? { breakRepairLive: false, breakRepairShown: false };
  },
};

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

export function loadGame() {
  return readValidPayload()?.state ?? null;
}

export function getSavedAt() {
  return readValidPayload()?.savedAt ?? null;
}

const DEFAULT_MUSIC_VOLUME = 0.5;

export function loadMusicVolume() {
  const v = Number.parseFloat(backend.read(MUSIC_VOLUME_KEY));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_MUSIC_VOLUME;
}

export function saveMusicVolume(volume) {
  backend.write(String(volume), MUSIC_VOLUME_KEY);
}

export function loadMuted() {
  return backend.read(MUTED_KEY) === '1';
}

export function saveMuted(muted) {
  backend.write(muted ? '1' : '0', MUTED_KEY);
}
