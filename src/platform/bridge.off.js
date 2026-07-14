// bridge.off.js — inert twin of bridge.js for the zero-external-calls YouTube
// build ('#bridge' alias). Keep the export list in lockstep with bridge.js.
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
