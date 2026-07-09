// Product photos for the supermarket's A/B/C/D types, drawn into the existing
// canvas-sprite labels (shelf signs + customer head labels) in place of the raw
// letter. The letters stay the internal product keys everywhere in core — this
// module is the only place they map to images. Loading starts at import; the
// draw sites fall back to the letter until a photo is ready (they re-draw once
// getProductImage flips non-null, so a slow load self-heals).
const SOURCES = {
  A: '/assets/images/fruit.png',
  B: '/assets/images/bakery.png',
  C: '/assets/images/veg.png',
  D: '/assets/images/dairy.png',
};

const images = {};
for (const [type, src] of Object.entries(SOURCES)) {
  const img = new Image();
  img.src = src;
  images[type] = img;
}

/** The product photo for a type, or null while it loads / if it failed (draw the letter instead). */
export function getProductImage(type) {
  const img = images[type];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
