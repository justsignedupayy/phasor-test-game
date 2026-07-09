import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * popup.js — floating DOM cash text at a screen point. One-shot: animates
 * then removes itself.
 */

/** Project a world point to fixed-position screen coords (for popup placement). */
export function worldToScreen(pos3d, camera, rendererDom) {
  const v = new THREE.Vector3(pos3d.x, pos3d.y, pos3d.z).project(camera);
  const rect = rendererDom.getBoundingClientRect();
  return {
    x: (v.x * 0.5 + 0.5) * rect.width + rect.left,
    y: (-v.y * 0.5 + 0.5) * rect.height + rect.top,
  };
}

export function showCashPopup(text, x, y) {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -50%)',
    font: `800 34px ${settings.ui.fontStack}`,
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
