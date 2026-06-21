/**
 * format.js — compact money formatting (1543200 -> "1.54M", 12000 -> "12.0K").
 * No currency symbol: callers prepend "$"/"+$" where one belongs. No Three.js.
 */
const UNITS = ['', 'K', 'M', 'B', 'T'];

const decimalsFor = (v) => (v >= 100 ? 0 : v >= 10 ? 1 : 2);

export function formatMoney(n) {
  const sign = n < 0 ? '-' : '';
  let abs = Math.abs(n);

  if (abs < 1000) return `${sign}${Math.round(abs)}`;

  let i = 0;
  while (abs >= 1000 && i < UNITS.length - 1) {
    abs /= 1000;
    i += 1;
  }

  let str = abs.toFixed(decimalsFor(abs));

  // Rounding can push e.g. 999.996 -> "1000"; bump to the next unit.
  if (parseFloat(str) >= 1000 && i < UNITS.length - 1) {
    abs /= 1000;
    i += 1;
    str = abs.toFixed(decimalsFor(abs));
  }

  return `${sign}${str}${UNITS[i]}`;
}
