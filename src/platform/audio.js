/**
 * audio.js — background music behind the same swappable-host philosophy as
 * storage.js / ads.js, isolated for the Playgama port. One looping track,
 * started on load; if the browser's autoplay policy blocks it, playback is
 * retried on the first user gesture instead (pointerdown/keydown), so the
 * music always ends up running without any error surfacing to the player.
 */
import { loadMusicVolume, saveMusicVolume } from './storage.js';

const MUSIC_SRC = '/assets/audio/bgmusic.mp3';

let music = null;

export function initMusic() {
  if (music) return; // idempotent — the track is created once
  music = new Audio(MUSIC_SRC);
  music.loop = true;
  music.volume = loadMusicVolume();
  music.play().catch(() => {
    // Autoplay blocked — wait for the first user gesture, then start.
    const resume = () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      music.play().catch(() => {}); // still blocked somehow — stay silent
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  });
}

/** Current music volume in [0, 1] (the persisted value until initMusic runs). */
export function getMusicVolume() {
  return music ? music.volume : loadMusicVolume();
}

/** Set music volume in [0, 1]; applies live and persists across sessions. */
export function setMusicVolume(v) {
  const clamped = Math.min(1, Math.max(0, v));
  if (music) music.volume = clamped;
  saveMusicVolume(clamped);
}
