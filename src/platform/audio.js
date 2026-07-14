// audio.js — all music/sfx. iOS Safari ignores HTMLMediaElement.volume writes,
// so every element routes through a WebAudio GainNode via createAudio(), and
// volume moves only through setVolume()/getVolume().
import settings from '../config/settings.js';
import { loadMusicVolume, saveMusicVolume, loadMuted, saveMuted } from './storage.js';
import { assetUrl } from './assetUrl.js';

const ASSET_DIR = assetUrl('assets/audio/');

let audioCtx = null;
let ctxUnlockBound = false;
const gains = new WeakMap(); // HTMLAudioElement -> its GainNode

function getAudioContext() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  ensureContextUnlock();
  return audioCtx;
}

function ensureContextUnlock() {
  if (ctxUnlockBound || !audioCtx || audioCtx.state === 'running') return;
  ctxUnlockBound = true;
  const resume = () => {
    audioCtx
      .resume()
      .then(() => {
        if (audioCtx.state !== 'running') return; // still locked — retry on the next gesture
        ctxUnlockBound = false;
        window.removeEventListener('pointerup', resume, true);
        window.removeEventListener('keydown', resume, true);
      })
      .catch(() => {});
  };
  window.addEventListener('pointerup', resume, true);
  window.addEventListener('keydown', resume, true);
}

function createAudio(src, volume, { loop = false } = {}) {
  const el = new Audio(src);
  el.loop = loop;
  const ctx = getAudioContext();
  if (ctx) {
    try {
      const gain = ctx.createGain();
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(ctx.destination);
      gains.set(el, gain);
    } catch {
    }
  }
  setVolume(el, volume);
  return el;
}

function setVolume(el, v) {
  const gain = gains.get(el);
  if (gain) gain.gain.value = v;
  else el.volume = v;
}

function getVolume(el) {
  const gain = gains.get(el);
  return gain ? gain.gain.value : el.volume;
}

let music = null;
let ambience = null; // { garage, gasStation, market } Audio instances

let hammerSound = null;
let moneySound = null;
let bagSound = null;

let muted = loadMuted();
let platformMuted = false;
let musicVolume = loadMusicVolume();

function isSilenced() {
  return muted || platformMuted;
}

function applyMuteState() {
  const s = isSilenced();
  if (music) setVolume(music, s ? 0 : musicVolume);
  if (ambience && s) for (const key of Object.keys(ambience)) setVolume(ambience[key], 0);
  if (hammerSound) setVolume(hammerSound, s ? 0 : settings.audio.hammerVolume);
}

export function reloadAudioSettings() {
  muted = loadMuted();
  musicVolume = loadMusicVolume();
  applyMuteState();
}

const pendingAutoplay = [];
let gestureListenerBound = false;

function ensureGestureUnlock() {
  if (gestureListenerBound) return;
  gestureListenerBound = true;
  // pointerup (touch grants activation there, not at pointerdown) + capture
  // phase (canvas tap handlers stopPropagation()).
  const resume = () => {
    if (pendingAutoplay.length === 0) {
      gestureListenerBound = false;
      window.removeEventListener('pointerup', resume, true);
      window.removeEventListener('keydown', resume, true);
      return;
    }
    for (const audio of [...pendingAutoplay]) {
      audio.play().then(
        () => {
          const i = pendingAutoplay.indexOf(audio);
          if (i !== -1) pendingAutoplay.splice(i, 1);
        },
        () => {} // still blocked — stay queued and retry on the next gesture
      );
    }
  };
  window.addEventListener('pointerup', resume, true);
  window.addEventListener('keydown', resume, true);
}

function startLooping(src, volume) {
  const audio = createAudio(ASSET_DIR + src, volume, { loop: true });
  audio.play().catch(() => {
    pendingAutoplay.push(audio);
    ensureGestureUnlock();
  });
  return audio;
}

export function initMusic() {
  if (music) return; // idempotent — the track is created once
  music = startLooping('bgmusic.mp3', isSilenced() ? 0 : musicVolume);
}

export function getMusicVolume() {
  return musicVolume;
}

export function setMusicVolume(v) {
  musicVolume = Math.min(1, Math.max(0, v));
  if (music && !isSilenced()) setVolume(music, musicVolume);
  saveMusicVolume(musicVolume);
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  saveMuted(muted);
  applyMuteState();
}

export function setPlatformMuted(m) {
  platformMuted = !!m;
  applyMuteState();
}

export function initAmbience() {
  if (ambience) return; // idempotent
  ambience = {
    garage: startLooping('garagebg.mp3', 0),
    gasStation: startLooping('gas_stationbg.mp3', 0),
    market: startLooping('marketbg.mp3', 0),
  };
}

export function updateAmbience(zone, dt) {
  if (!ambience) return;
  const A = settings.audio;
  const rate = Math.min(1, dt / A.ambienceFadeDuration);
  const silenced = isSilenced();
  const targets = {
    garage: !silenced && zone === 'garage' ? A.garageVolume : 0,
    gasStation: !silenced && zone === 'gasStation' ? A.gasStationVolume : 0,
    market: !silenced && zone === 'market' ? A.marketVolume : 0,
  };
  for (const key of Object.keys(targets)) {
    const track = ambience[key];
    const cur = getVolume(track);
    setVolume(track, cur + (targets[key] - cur) * rate);
  }
}

export function suspendAll() {
  if (music && !music.paused) music.pause();
  if (ambience) for (const key of Object.keys(ambience)) ambience[key].paused || ambience[key].pause();
  if (hammerSound && !hammerSound.paused) hammerSound.pause();
}

export function resumeAll() {
  if (audioCtx && audioCtx.state !== 'running') {
    audioCtx.resume().catch(() => {});
    ensureContextUnlock();
  }
  const tracks = [music, ...(ambience ? Object.values(ambience) : [])];
  for (const audio of tracks) {
    if (!audio) continue;
    audio.play().catch(() => {
      if (!pendingAutoplay.includes(audio)) pendingAutoplay.push(audio);
      ensureGestureUnlock();
    });
  }
}

export function setHammerActive(active) {
  if (!hammerSound) {
    hammerSound = createAudio(ASSET_DIR + 'hammersound.mp3', isSilenced() ? 0 : settings.audio.hammerVolume, {
      loop: true,
    });
  }
  if (active) {
    if (hammerSound.paused) hammerSound.play().catch(() => {});
  } else if (!hammerSound.paused) {
    hammerSound.pause();
  }
}

export function playMoneySound() {
  if (isSilenced()) return;
  if (!moneySound) {
    moneySound = createAudio(ASSET_DIR + 'moneysound.mp3', settings.audio.moneyVolume);
  }
  moneySound.currentTime = 0;
  moneySound.play().catch(() => {});
}

export function playBagSound() {
  if (isSilenced()) return;
  if (!bagSound) {
    bagSound = createAudio(ASSET_DIR + 'plasticbag.mp3', settings.audio.bagVolume);
  }
  bagSound.currentTime = 0;
  bagSound.play().catch(() => {});
}

export function playDoorOpenSound() {
  if (isSilenced()) return;
  const audio = createAudio(ASSET_DIR + 'autdooropen.mp3', settings.audio.doorOpenVolume);
  audio.play().catch(() => {});
}

export function playDoorCloseSound() {
  if (isSilenced()) return;
  const audio = createAudio(ASSET_DIR + 'autodoorclose.mp3', settings.audio.doorCloseVolume);
  audio.play().catch(() => {});
}
