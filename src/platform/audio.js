/**
 * audio.js — every sound effect + music track behind the same swappable-host
 * philosophy as storage.js / ads.js, isolated for the Playgama port.
 *
 * bgmusic loops everywhere, started on load. Three area-ambience layers
 * (garage/gas station/market) loop ON TOP of it simultaneously from load,
 * silently (volume 0) until updateAmbience fades the current zone's track up
 * and the others down each frame — a continuous crossfade with no restart.
 * If the browser's autoplay policy blocks any of these four looping tracks,
 * playback is retried on the first user gesture instead (pointerdown/keydown)
 * — ONE shared listener pair services all of them, so a gesture that arrives
 * before every track has failed still catches the rest.
 *
 * The remaining triggered sounds (hammer/money/bag) are only ever started
 * from a later game action, by which point the page already has a user
 * gesture on record, so they never need the gesture-retry path. Each of
 * those reuses one Audio instance, created once. The door open/close sounds
 * are the one exception: multiple doors can trigger within the same moment,
 * so each of those plays a freshly-constructed Audio instance instead (see
 * playDoorOpenSound/playDoorCloseSound) rather than risk one shared instance
 * cutting off an in-progress play.
 */
import settings from '../config/settings.js';
import { loadMusicVolume, saveMusicVolume, loadMuted, saveMuted } from './storage.js';

const ASSET_DIR = '/assets/audio/';

let music = null;
let ambience = null; // { garage, gasStation, market } Audio instances

let hammerSound = null;
let moneySound = null;
let bagSound = null;

// Global mute (Settings panel). While muted every track's volume is forced to
// 0 and every one-shot is skipped; the REMEMBERED volume levels (musicVolume
// below + the settings.audio.* constants) are untouched, so unmuting restores
// them exactly. Persisted like the volume (see storage.loadMuted/saveMuted).
let muted = loadMuted();
// The music volume SETTING, kept apart from music.volume so mute can zero the
// live track without losing the slider's remembered level.
let musicVolume = loadMusicVolume();

/**
 * Re-read the persisted mute/volume prefs. The two module-scope reads above
 * run at import time — BEFORE main.js's boot can swap in the Bridge storage
 * backend — so on a Bridge platform they'd see localStorage, not the real
 * store. main.js calls this right after a successful backend swap (still
 * before initMusic/initAmbience, but apply to any live tracks defensively).
 */
export function reloadAudioSettings() {
  muted = loadMuted();
  musicVolume = loadMusicVolume();
  if (music) music.volume = muted ? 0 : musicVolume;
  if (hammerSound) hammerSound.volume = muted ? 0 : settings.audio.hammerVolume;
  if (ambience && muted) for (const key of Object.keys(ambience)) ambience[key].volume = 0;
}

// Autoplay-blocked tracks waiting on the first user gesture, serviced by one
// shared listener pair (see module doc above).
const pendingAutoplay = [];
let gestureListenerBound = false;

function ensureGestureUnlock() {
  if (gestureListenerBound) return;
  gestureListenerBound = true;
  const resume = () => {
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
    for (const audio of pendingAutoplay) audio.play().catch(() => {}); // still blocked somehow — stay silent
    pendingAutoplay.length = 0;
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
}

/** Starts a looping track immediately; on autoplay failure, retries on the shared gesture unlock. */
function startLooping(src, volume) {
  const audio = new Audio(ASSET_DIR + src);
  audio.loop = true;
  audio.volume = volume;
  audio.play().catch(() => {
    pendingAutoplay.push(audio);
    ensureGestureUnlock();
  });
  return audio;
}

export function initMusic() {
  if (music) return; // idempotent — the track is created once
  music = startLooping('bgmusic.mp3', muted ? 0 : musicVolume);
}

/** Current music volume SETTING in [0, 1] — the slider's remembered level,
 * regardless of whether mute is currently forcing the live track to 0. */
export function getMusicVolume() {
  return musicVolume;
}

/** Set music volume in [0, 1]; persists across sessions and applies live
 * unless muted (the remembered level still updates, heard on unmute). */
export function setMusicVolume(v) {
  musicVolume = Math.min(1, Math.max(0, v));
  if (music && !muted) music.volume = musicVolume;
  saveMusicVolume(musicVolume);
}

/** Current global-mute state (Settings panel's mute button). */
export function isMuted() {
  return muted;
}

/**
 * Set the global mute; persists across sessions. Muting silences every track
 * INSTANTLY (music, ambience, hammer loop — one-shots are skipped at play
 * time); unmuting restores the music to its remembered volume, the hammer to
 * its tuned volume, and lets updateAmbience fade the current zone back in.
 */
export function setMuted(m) {
  muted = !!m;
  saveMuted(muted);
  if (music) music.volume = muted ? 0 : musicVolume;
  if (ambience && muted) for (const key of Object.keys(ambience)) ambience[key].volume = 0;
  if (hammerSound) hammerSound.volume = muted ? 0 : settings.audio.hammerVolume;
}

/** Starts all three area-ambience layers, silent until updateAmbience fades one in. */
export function initAmbience() {
  if (ambience) return; // idempotent
  ambience = {
    garage: startLooping('garagebg.mp3', 0),
    gasStation: startLooping('gas_stationbg.mp3', 0),
    market: startLooping('marketbg.mp3', 0),
  };
}

/**
 * Call every frame with the player's current zone ('garage' | 'gasStation' |
 * 'market' | null) — each track's volume eases toward its target (the tuned
 * settings.audio.*Volume while it's the current zone, else 0) over
 * settings.audio.ambienceFadeDuration seconds, so crossing a zone boundary
 * fades tracks rather than cutting them.
 */
export function updateAmbience(zone, dt) {
  if (!ambience) return;
  const A = settings.audio;
  const rate = Math.min(1, dt / A.ambienceFadeDuration);
  // While muted every target is 0, so the per-frame ease can never fade a
  // zone back in over the instant silence setMuted applied.
  const targets = {
    garage: !muted && zone === 'garage' ? A.garageVolume : 0,
    gasStation: !muted && zone === 'gasStation' ? A.gasStationVolume : 0,
    market: !muted && zone === 'market' ? A.marketVolume : 0,
  };
  for (const key of Object.keys(targets)) {
    const track = ambience[key];
    track.volume += (targets[key] - track.volume) * rate;
  }
}

/**
 * Pause every LOOPING track — call when the page is hidden (tab switch /
 * app minimize), where HTMLAudioElements would otherwise keep sounding even
 * though requestAnimationFrame (and so the game) is throttled to a halt.
 * One-shots (money/bag/door) are sub-second fire-and-forget and need no
 * handling; the hammer loop is paused here and resumes itself on the first
 * visible frame via setHammerActive (called every frame while repairing).
 */
export function suspendAll() {
  if (music && !music.paused) music.pause();
  if (ambience) for (const key of Object.keys(ambience)) ambience[key].paused || ambience[key].pause();
  if (hammerSound && !hammerSound.paused) hammerSound.pause();
}

/** Resume the tracks suspendAll paused (page visible again). Mute state needs
 * no special casing — muted tracks play at volume 0. A track that was never
 * started (autoplay still blocked) just fails quietly and stays on the shared
 * gesture-unlock path. */
export function resumeAll() {
  if (music) music.play().catch(() => {});
  if (ambience) for (const key of Object.keys(ambience)) ambience[key].play().catch(() => {});
}

/** Loop/stop the repair-hammering sound (player or any pit mechanic actively repairing). */
export function setHammerActive(active) {
  if (!hammerSound) {
    hammerSound = new Audio(ASSET_DIR + 'hammersound.mp3');
    hammerSound.loop = true;
    hammerSound.volume = muted ? 0 : settings.audio.hammerVolume;
  }
  if (active) {
    if (hammerSound.paused) hammerSound.play().catch(() => {});
  } else if (!hammerSound.paused) {
    hammerSound.pause();
  }
}

/** One-shot: a discrete completed cash gain (pit/pump collect, or an unlock marker finalizing). */
export function playMoneySound() {
  if (muted) return;
  if (!moneySound) {
    moneySound = new Audio(ASSET_DIR + 'moneysound.mp3');
    moneySound.volume = settings.audio.moneyVolume;
  }
  moneySound.currentTime = 0;
  moneySound.play().catch(() => {});
}

/** One-shot: a supermarket customer's checkout completing. */
export function playBagSound() {
  if (muted) return;
  if (!bagSound) {
    bagSound = new Audio(ASSET_DIR + 'plasticbag.mp3');
    bagSound.volume = settings.audio.bagVolume;
  }
  bagSound.currentTime = 0;
  bagSound.play().catch(() => {});
}

/**
 * One-shot: a sliding door opening. Unlike the sounds above, a fresh Audio
 * instance is created and played EVERY call — several doors can open within
 * the same moment (see scene/SlidingDoors.js), and a single shared instance
 * would cut off an already-playing door sound instead of layering.
 */
export function playDoorOpenSound() {
  if (muted) return;
  const audio = new Audio(ASSET_DIR + 'autdooropen.mp3'); // filename typo is intentional — matches the shipped asset
  audio.volume = settings.audio.doorOpenVolume;
  audio.play().catch(() => {});
}

/** One-shot: a sliding door closing (see playDoorOpenSound above). */
export function playDoorCloseSound() {
  if (muted) return;
  const audio = new Audio(ASSET_DIR + 'autodoorclose.mp3');
  audio.volume = settings.audio.doorCloseVolume;
  audio.play().catch(() => {});
}
