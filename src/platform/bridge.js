// bridge.js — the ONE module that knows Playgama Bridge exists. Reached only
// via the '#bridge' alias; bridge.off.js is its inert twin for the YouTube build.
const SCRIPT_URL = 'https://bridge.playgama.com/v2/stable/playgama-bridge.js';
const SCRIPT_TIMEOUT_MS = 10000; // CDN unreachable -> give up and run local
const INIT_TIMEOUT_MS = 10000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

let bridgeInstance = null;
let platformMuted = false;

export function getBridge() {
  return bridgeInstance;
}

export function isPlatformMuted() {
  return platformMuted;
}

export function sendGameReady() {
  try {
    bridgeInstance?.platform?.sendMessage('game_ready');
  } catch {
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

export async function initBridge({ onPauseChange, onMuteChange } = {}) {
  try {
    await loadScript();
    console.log('[bridge] script loaded');
    const bridge = window.bridge;
    if (!bridge?.initialize) throw new Error('Bridge global missing after script load');
    await withTimeout(bridge.initialize(), INIT_TIMEOUT_MS, 'bridge.initialize()');
    bridgeInstance = bridge;
    console.log('[bridge] initialized, platform:', bridge.platform?.id ?? 'unknown');

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
    }
    platformMuted = bridge.platform?.isAudioEnabled === false; // initial state — events only fire on changes
    return true;
  } catch (err) {
    console.warn('[bridge] unavailable, running with local fallbacks:', err?.message ?? err);
    bridgeInstance = null;
    return false;
  }
}

// Backend over Bridge storage; hydrates every key up front so read() is sync.
// This hydration is also the ONLY genuine platform read — the SDK serves later
// gets from its own cache, so a host-side "Reset Progress" is invisible
// mid-session (detected at next boot by storage.js reconcilePlatformReset).
export async function createBridgeStorageBackend(keys) {
  if (!bridgeInstance?.storage) return null;
  try {
    const values = await withTimeout(bridgeInstance.storage.get(keys), INIT_TIMEOUT_MS, 'bridge storage hydration');
    console.log('[bridge] storage hydrated');
    const cache = new Map();
    keys.forEach((key, i) => {
      const v = Array.isArray(values) ? values[i] : null;
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
        }
      },
    };
  } catch (err) {
    console.warn('[bridge] storage hydration failed, staying on localStorage:', err?.message ?? err);
    return null;
  }
}
