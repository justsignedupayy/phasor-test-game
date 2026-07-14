import { getBridge } from '#bridge';

let pauseHooks = { pause: () => {}, resume: () => {} };

export function configureAdPause(hooks) {
  pauseHooks = hooks;
}

let adActive = false;
let adRewarded = false;
let finishAd = null; // (success) => void for the in-flight request
let listenerBound = false;
let watchdog = 0;

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
    Promise.resolve(bridge.advertisement.showRewarded()).catch(() => finishAd?.(false));
  } catch {
    finishAd?.(false);
  }
}
