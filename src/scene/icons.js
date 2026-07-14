import { assetUrl } from '../platform/assetUrl.js';

const moneyIcon = new Image();
const lockIcon = new Image();

let promise = null;

export function preloadIcons() {
  if (!promise) {
    promise = Promise.all([
      load(moneyIcon, assetUrl('assets/images/money.png')),
      load(lockIcon, assetUrl('assets/images/lock.png')),
    ]);
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
