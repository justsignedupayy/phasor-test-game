import { assetUrl } from '../platform/assetUrl.js';

const SOURCES = {
  A: assetUrl('assets/images/fruit.png'),
  B: assetUrl('assets/images/bakery.png'),
  C: assetUrl('assets/images/veg.png'),
  D: assetUrl('assets/images/dairy.png'),
};

const images = {};
for (const [type, src] of Object.entries(SOURCES)) {
  const img = new Image();
  img.src = src;
  images[type] = img;
}

export function getProductImage(type) {
  const img = images[type];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
