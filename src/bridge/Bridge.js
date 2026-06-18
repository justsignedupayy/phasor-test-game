/**
 * Bridge.js — Playgama Bridge SDK wrapper
 * Handles SDK initialization and exposes game lifecycle + ad methods.
 * Playgama Bridge automatically detects the platform (YouTube, Playgama, etc.)
 * and routes calls accordingly. In local dev it uses safe mock defaults.
 */

const Bridge = {
  initialized: false,

  /**
   * Initialize the Bridge SDK.
   * Must be called before any other Bridge method.
   * @returns {Promise<void>}
   */
  async init() {
    try {
      await bridge.initialize();
      this.initialized = true;
      console.log('[Bridge] Initialized on platform:', bridge.platform.id);
    } catch (err) {
      console.warn('[Bridge] Initialization failed, running in fallback mode:', err);
      this.initialized = false;
    }
  },

  /**
   * Signal that the first playable frame is ready.
   * Call this once the game is fully loaded and the player can interact.
   */
  gameReady() {
    bridge.platform.sendMessage('game_ready');
  },

  /**
   * Get the player's preferred language from the platform.
   * Falls back to browser language if unavailable.
   * @returns {string} e.g. 'en', 'tr'
   */
  getLanguage() {
    return bridge.platform.language || navigator.language?.split('-')[0] || 'en';
  },

  /**
   * Show an interstitial ad.
   * Call at natural breakpoints: level transitions, game over screen, etc.
   * Never call between rapid gameplay actions.
   * @returns {Promise<void>}
   */
  async showInterstitial() {
    try {
      await bridge.advertisement.showInterstitial();
    } catch (err) {
      console.warn('[Bridge] Interstitial ad failed:', err);
    }
  },

  /**
   * Show a rewarded ad.
   * Call only when the player explicitly opts in (e.g. "Watch ad for extra life").
   * @param {Function} onRewarded - Called if the player earns the reward.
   * @param {Function} [onFailed] - Called if the ad fails or player skips.
   */
  async showRewarded(onRewarded, onFailed) {
    try {
      const earned = await bridge.advertisement.showRewarded();
      if (earned) {
        onRewarded?.();
      } else {
        onFailed?.();
      }
    } catch (err) {
      console.warn('[Bridge] Rewarded ad failed:', err);
      onFailed?.();
    }
  },

  /**
   * Save game data to platform storage.
   * @param {string} key
   * @param {*} value — will be JSON stringified
   */
  async save(key, value) {
    try {
      await bridge.storage.set(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[Bridge] Save failed:', err);
    }
  },

  /**
   * Load game data from platform storage.
   * @param {string} key
   * @returns {Promise<*>} Parsed value or null if not found
   */
  async load(key) {
    try {
      const raw = await bridge.storage.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('[Bridge] Load failed:', err);
      return null;
    }
  },
};

export default Bridge;
