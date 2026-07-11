/**
 * bridge.js — the ONE module that knows Playgama Bridge exists. Everything
 * platform-shaped (ads.js, storage.js via main.js, main.js itself) talks to
 * Bridge through the functions exported here, so the Bridge-free YouTube
 * build can swap this whole file for bridge.off.js (see vite/config.youtube.mjs
 * — both are reached through the '#bridge' alias, never imported directly).
 *
 * Playgama has NO npm package: the official plain-JS integration is a CDN
 * script that defines a global `bridge` and auto-loads the current platform's
 * own SDK behind it. We inject that script tag at boot instead of shipping it
 * in index.html so a load failure (offline dev, unsupported host, ad blocker)
 * is just a caught error here — initBridge() resolves false and the game runs
 * on its local fallbacks (localStorage saves, stubbed always-succeed ads).
 *
 * API surface used (per wiki.playgama.com/playgama/bridge-sdk, v2):
 *   bridge.initialize() -> Promise
 *   bridge.platform.sendMessage('game_ready')
 *   bridge.platform.on(EVENT_NAME.PAUSE_STATE_CHANGED, isPaused => …)
 *   bridge.platform.on(EVENT_NAME.AUDIO_STATE_CHANGED, isEnabled => …)
 *   bridge.platform.isAudioEnabled            (initial state — events only
 *                                              fire on later changes)
 *   bridge.storage.get/set/delete([keys], [values]) -> Promise
 *   (advertisement API is consumed by ads.js via getBridge())
 */
const SCRIPT_URL = 'https://bridge.playgama.com/v2/stable/playgama-bridge.js';
const SCRIPT_TIMEOUT_MS = 10000; // CDN unreachable -> give up and run local

let bridgeInstance = null;
let platformMuted = false;

/** The initialized Bridge global, or null when unavailable (init failed, or
 * this is the Bridge-free build). Callers must handle null. */
export function getBridge() {
  return bridgeInstance;
}

/** True while the PLATFORM has audio disabled (its own mute toggle, or an ad
 * playing). main.js checks this so a visibility-resume never restarts audio
 * over a platform mute. */
export function isPlatformMuted() {
  return platformMuted;
}

/** Mandatory Playgama signal: the game is loaded and playable. Call exactly
 * once, right after the loading overlay is gone — never earlier. */
export function sendGameReady() {
  try {
    bridgeInstance?.platform?.sendMessage('game_ready');
  } catch {
    // a failed courtesy signal must never break the game
  }
}

function loadScript() {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    const timer = setTimeout(() => {
      el.remove();
      reject(new Error('Bridge script load timed out'));
    }, SCRIPT_TIMEOUT_MS);
    el.src = SCRIPT_URL;
    el.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Bridge script failed to load'));
    };
    document.head.appendChild(el);
  });
}

/**
 * Load + initialize Bridge and wire the platform's pause/audio commands to
 * the game's handlers. Resolves true when Bridge is usable, false on ANY
 * failure — the caller then just stays on the local implementations.
 *
 * onPauseChange(isPaused) — platform pause/resume (tab hidden, ad opened…).
 * onMuteChange(isMuted)   — platform audio off/on. NOT called for the initial
 * state: events only fire on changes, and applying the initial value must
 * wait until the storage backend swap (else setMuted's persist would write to
 * the wrong store) — main.js reads isPlatformMuted() for that instead.
 */
export async function initBridge({ onPauseChange, onMuteChange } = {}) {
  try {
    await loadScript();
    const bridge = window.bridge;
    if (!bridge?.initialize) throw new Error('Bridge global missing after script load');
    await bridge.initialize();
    bridgeInstance = bridge;

    // Event constants with string fallbacks — EVENT_NAME is documented, but a
    // Bridge build that renames it should degrade to no events, not a crash.
    const EV = bridge.EVENT_NAME ?? {};
    try {
      bridge.platform?.on?.(EV.PAUSE_STATE_CHANGED ?? 'pause_state_changed', (isPaused) => {
        onPauseChange?.(!!isPaused);
      });
      bridge.platform?.on?.(EV.AUDIO_STATE_CHANGED ?? 'audio_state_changed', (isEnabled) => {
        platformMuted = !isEnabled;
        onMuteChange?.(platformMuted);
      });
    } catch {
      // events unsupported on this platform — polling isAudioEnabled isn't
      // worth it; the game just keeps its own audio controls
    }
    // Initial audio state must be read manually (see module doc).
    platformMuted = bridge.platform?.isAudioEnabled === false;
    return true;
  } catch (err) {
    console.warn('[bridge] unavailable, running with local fallbacks:', err?.message ?? err);
    bridgeInstance = null;
    return false;
  }
}

/**
 * Build a storage.js-compatible backend over Bridge storage, hydrating every
 * persisted key up front so backend.read stays SYNCHRONOUS (loadGame & co.
 * run at boot, before the first frame — they can't await). Writes update the
 * cache immediately and flush to Bridge fire-and-forget, mirroring how
 * localStorage writes were already best-effort.
 *
 * Returns null if hydration fails — caller keeps the localStorage backend.
 */
export async function createBridgeStorageBackend(keys) {
  if (!bridgeInstance?.storage) return null;
  try {
    const values = await bridgeInstance.storage.get(keys);
    const cache = new Map();
    keys.forEach((key, i) => {
      const v = Array.isArray(values) ? values[i] : null;
      // Some platforms hand parsed objects back for JSON payloads; storage.js
      // expects the raw string it wrote, so re-stringify anything non-string.
      cache.set(key, typeof v === 'string' ? v : v == null ? null : JSON.stringify(v));
    });
    return {
      read(key) {
        return cache.get(key) ?? null;
      },
      write(raw, key) {
        cache.set(key, raw);
        bridgeInstance.storage.set([key], [raw]).catch(() => {}); // best-effort, like localStorage
      },
      wipe() {
        cache.clear();
        bridgeInstance.storage.delete(keys).catch(() => {});
        try {
          localStorage.clear(); // clear any pre-swap local writes too (debug reset semantics)
        } catch {
          // storage unavailable — nothing local to wipe
        }
      },
    };
  } catch (err) {
    console.warn('[bridge] storage hydration failed, staying on localStorage:', err?.message ?? err);
    return null;
  }
}
