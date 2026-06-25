/**
 * storage.js — save/load persistence behind a small backend abstraction, so
 * step 8 can swap in Playgama's storage by changing only `backend` below.
 * Default backend: localStorage. The save payload carries a saveVersion so a
 * future format change can migrate or safely discard old saves.
 */
const SAVE_KEY = 'garageIdleSave';
const SAVE_VERSION = 6; // v6: supermarket (shelves/customers/worker); v5: per-pit tires/shelf + conveyor + carried box; v4: pendingCash + cashier; v3: 5 pits

const backend = {
  read() {
    try {
      return localStorage.getItem(SAVE_KEY);
    } catch {
      return null; // storage unavailable (private mode, disabled, etc.)
    }
  },
  write(raw) {
    try {
      localStorage.setItem(SAVE_KEY, raw);
    } catch {
      // storage unavailable or quota exceeded — drop the save silently
    }
  },
};

export function saveGame(state) {
  backend.write(JSON.stringify({ saveVersion: SAVE_VERSION, state }));
}

/** Returns the saved GameState-shaped object, or null if there's no valid save. */
export function loadGame() {
  const raw = backend.read();
  if (!raw) return null;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!payload || payload.saveVersion !== SAVE_VERSION) return null;
  return payload.state;
}
