/**
 * ads.js — rewarded-ad entry point. With Bridge available (the Playgama
 * build, successfully initialized) it drives the real rewarded flow:
 * pause the game, bridge.advertisement.showRewarded(), then resolve off the
 * REWARDED_STATE_CHANGED events — onComplete ONLY on the 'rewarded' state
 * (closing early or a load failure is onFail), and the game unpauses on
 * whichever terminal state arrives. Without Bridge (YouTube build, or Bridge
 * init failed) it keeps the original stub behavior: succeed immediately.
 */
import { getBridge } from '#bridge';

// Game-pause hooks, registered by main.js at boot (ads.js can't import
// main.js — it's the entry module). Defaults are no-ops so a stray ad call
// before registration can't crash.
let pauseHooks = { pause: () => {}, resume: () => {} };

/** main.js hands us its ad-pause flag setters (they feed the same combined
 * pause state the pause button and platform pause use). */
export function configureAdPause(hooks) {
  pauseHooks = hooks;
}

// One ad at a time; the subscription is module-level and permanent (Bridge
// has on() but no documented off()), so per-request state lives here.
let adActive = false;
let adRewarded = false;
let finishAd = null; // (success) => void for the in-flight request
let listenerBound = false;
let watchdog = 0;

// No event at all shortly after showRewarded (event-name mismatch, silent
// platform failure) would leave the game paused forever — fail the request.
// Any arriving state event clears this; 'loading'/'opened' prove the flow is
// alive and closed/failed will follow.
const NO_EVENT_TIMEOUT_MS = 15000;

function bindListener(bridge) {
  if (listenerBound) return;
  listenerBound = true;
  const EV = bridge.EVENT_NAME ?? {};
  bridge.advertisement.on(EV.REWARDED_STATE_CHANGED ?? 'rewarded_state_changed', (state) => {
    if (!adActive) return; // a state echo from a previous request
    clearTimeout(watchdog);
    if (state === 'rewarded') {
      adRewarded = true; // reward is granted on close, not mid-ad
    } else if (state === 'closed') {
      finishAd?.(adRewarded);
    } else if (state === 'failed') {
      finishAd?.(false);
    }
  });
}

export function showRewardedAd(onComplete, onFail) {
  const bridge = getBridge();
  if (!bridge?.advertisement?.showRewarded) {
    // Local fallback — the original stub: always-successful, instant.
    onComplete();
    return;
  }
  if (adActive) return; // ignore double-taps while an ad is up

  bindListener(bridge);
  adActive = true;
  adRewarded = false;
  finishAd = (success) => {
    finishAd = null;
    adActive = false;
    clearTimeout(watchdog);
    pauseHooks.resume(); // restore the pre-ad pause state
    if (success) onComplete();
    else onFail?.();
  };

  pauseHooks.pause(); // freeze sims + silence audio under the ad
  watchdog = setTimeout(() => finishAd?.(false), NO_EVENT_TIMEOUT_MS);
  try {
    // Returns void or a promise depending on Bridge version; a rejection is
    // just a failed ad (the 'failed' event usually fires too — finishAd is
    // one-shot so double delivery is harmless).
    Promise.resolve(bridge.advertisement.showRewarded()).catch(() => finishAd?.(false));
  } catch {
    finishAd?.(false);
  }
}
