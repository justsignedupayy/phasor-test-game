import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * Pure geometry (primitives): desk + monitor + screen. Kept separate from the
 * Computer class's proximity/highlight behavior so a later art pass (e.g. a
 * GLTF model) is a drop-in replacement for just this function.
 */
export function createComputer() {
  const c = settings.colors;
  const mat = (col, extra = {}) => new THREE.MeshStandardMaterial({ color: col, flatShading: true, ...extra });

  const group = new THREE.Group();

  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.72, 0.85), mat(c.deskWood));
  desk.position.y = 0.36;
  desk.castShadow = true;
  desk.receiveShadow = true;
  group.add(desk);

  const standY = 0.72 + 0.15;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), mat(c.computerCase));
  stand.position.set(0, standY, -0.15);
  group.add(stand);

  const monitorY = standY + 0.15 + 0.25;
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.07), mat(c.computerCase));
  monitor.position.set(0, monitorY, -0.15);
  monitor.castShadow = true;
  group.add(monitor);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.38),
    mat(c.screenGlow, { emissive: c.screenGlow, emissiveIntensity: 0.6 })
  );
  screen.position.set(0, monitorY, -0.15 + 0.045);
  group.add(screen);

  return group;
}

/**
 * Computer — the garage's advertising terminal. Render-only: tracks whether
 * the player is close enough to use it (the same tap-affordance ring a pit
 * shows) and exposes raycastTap() so the input layer can open the Advertising
 * panel. No game logic lives here.
 */
export class Computer {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.pos = settings.computer;
    this.near = false;
    this.highlightT = 0;

    this.root = createComputer();
    this.root.position.set(this.pos.x, 0, this.pos.z);
    this.sm.add(this.root);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(this.pos.radius * 0.78, this.pos.radius, 40),
      new THREE.MeshBasicMaterial({
        color: settings.colors.pitGlow,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(this.pos.x, 0.05, this.pos.z);
    this.sm.add(this.ring);
  }

  update(dt, state) {
    const dx = state.player.position.x - this.pos.x;
    const dz = state.player.position.z - this.pos.z;
    this.near = Math.hypot(dx, dz) <= this.pos.radius;

    this.highlightT += dt;
    const target = this.near ? 0.45 + 0.22 * Math.sin(this.highlightT * 5) : 0;
    this.ring.material.opacity += (target - this.ring.material.opacity) * Math.min(1, 8 * dt);
  }

  /** True if the ray hits the terminal and the player is currently near it. */
  raycastTap(raycaster) {
    if (!this.near) return false;
    return raycaster.intersectObject(this.root, true).length > 0;
  }
}
