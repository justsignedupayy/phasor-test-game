/**
 * bridge.off.js — the Bridge-free twin of bridge.js, substituted by
 * vite/config.youtube.mjs's '#bridge' alias for the YouTube build (which must
 * make ZERO external calls — no CDN script, no Playgama endpoints). Same
 * exports, all inert: initBridge reports unavailable, so main.js/ads.js stay
 * on their local implementations (localStorage saves, stubbed ads) and the
 * whole real bridge.js — including its script injection — never enters the
 * bundle. Keep the export list in lockstep with bridge.js.
 */
export function getBridge() {
  return null;
}

export function isPlatformMuted() {
  return false;
}

export function sendGameReady() {}

export async function initBridge() {
  return false;
}

export async function createBridgeStorageBackend() {
  return null;
}
