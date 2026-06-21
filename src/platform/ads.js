/**
 * ads.js — rewarded-ad entry point, isolated so swapping in the real Playgama
 * rewarded ad later only touches this file. Stubbed for now: simulates an
 * always-successful ad and calls onComplete() immediately.
 */
export function showRewardedAd(onComplete, onFail) {
  onComplete();
}
