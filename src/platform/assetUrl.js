export function assetUrl(path) {
  return new URL(path.replace(/^\/+/, ''), document.baseURI).href;
}
