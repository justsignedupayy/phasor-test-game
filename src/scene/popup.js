/**
 * popup.js — a one-shot floating text element (e.g. "+$15") at a screen point.
 * Pure DOM; floats up and fades, then removes itself.
 */
export function showCashPopup(text, x, y) {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -50%)',
    font: '800 34px Arial, sans-serif',
    color: '#ffd23f',
    textShadow: '0 2px 0 #3a2a00, 0 0 10px rgba(0,0,0,0.5)',
    pointerEvents: 'none',
    zIndex: '20',
    opacity: '1',
    transition: 'transform 0.9s ease-out, opacity 0.9s ease-out',
  });
  document.body.appendChild(el);

  // Next frame: animate up + fade (so the transition actually runs).
  requestAnimationFrame(() => {
    el.style.transform = 'translate(-50%, -180%)';
    el.style.opacity = '0';
  });

  setTimeout(() => el.remove(), 1000);
}
