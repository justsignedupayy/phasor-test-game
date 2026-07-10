/**
 * icons.js — the two small UI icons (money.png, lock.png) that stand in for
 * the literal '$' and '🔒' glyphs in canvas-drawn labels. Canvas ctx.drawImage
 * needs the Image already loaded (unlike a DOM <img>, which loads itself), so
 * call (and await) preloadIcons() once during boot, before any canvas label
 * that reads getMoneyIcon()/getLockIcon() is first drawn.
 */
const moneyIcon = new Image();
const lockIcon = new Image();

let promise = null;

export function preloadIcons() {
  if (!promise) {
    promise = Promise.all([load(moneyIcon, '/assets/images/money.png'), load(lockIcon, '/assets/images/lock.png')]);
  }
  return promise;
}

function load(img, src) {
  return new Promise((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve(); // a missing icon must never brick the boot
    img.src = src;
  });
}

export function getMoneyIcon() {
  return moneyIcon;
}

export function getLockIcon() {
  return lockIcon;
}
