import * as THREE from 'three';
import settings from '../config/settings.js';
import { Mechanic } from './Mechanic.js';

/**
 * PitView — the static, per-pit scene furniture (no car logic; cars are owned by
 * CarYard). It renders three states with little appear animations:
 *
 *   locked       nothing visible
 *   roomUnlocked an empty lot patch + outline (Expand Room reveals this)
 *   equipped     the repair station floor + a toolbox (Buy Pit Equipment)
 *
 * It also owns this pit's worker NPC (spawned when hired) and the floor
 * highlight ring shown when the player can manually tap an unmanned pit.
 *
 * Driven by update(dt, pit); reads the core pit's booleans, never mutates them.
 */
export class PitView {
  constructor(sceneManager, index, gltf) {
    this.sm = sceneManager;
    this.index = index;
    this.pos = settings.pit.positions[index];
    this.gltf = gltf; // shared character model + clips, passed to this pit's Mechanic when hired

    this.mechanic = null;
    this.highlightT = 0;
    this.lotScale = 0; // animated 0..1
    this.stationScale = 0; // animated 0..1

    this.#build();
  }

  #build() {
    const c = settings.colors;
    const { x, z } = this.pos;

    // Empty lot: a faint floor patch + an outline ring.
    this.lot = new THREE.Group();
    this.lot.position.set(x, 0, z);
    this.lot.visible = false;
    const lotPatch = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 3.4),
      new THREE.MeshStandardMaterial({ color: c.lot })
    );
    lotPatch.rotation.x = -Math.PI / 2;
    lotPatch.position.y = 0.015;
    lotPatch.receiveShadow = true;
    this.lot.add(lotPatch);
    const lotEdge = new THREE.Mesh(
      new THREE.RingGeometry(2.05, 2.2, 4, 1),
      new THREE.MeshBasicMaterial({ color: c.lotEdge, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    lotEdge.rotation.x = -Math.PI / 2;
    lotEdge.rotation.z = Math.PI / 4;
    lotEdge.position.y = 0.02;
    this.lot.add(lotEdge);
    this.sm.add(this.lot);

    // Equipped station: brown pit floor + a toolbox marker.
    this.station = new THREE.Group();
    this.station.position.set(x, 0, z);
    this.station.visible = false;
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 3.4),
      new THREE.MeshStandardMaterial({ color: c.pit })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.025;
    pad.receiveShadow = true;
    this.station.add(pad);
    const toolbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: c.toolbox, flatShading: true })
    );
    toolbox.position.set(-1.7, 0.25, 1.3);
    toolbox.castShadow = true;
    this.station.add(toolbox);
    this.sm.add(this.station);

    // Highlight ring (player-can-tap affordance).
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(settings.pit.radius * 0.78, settings.pit.radius, 40),
      new THREE.MeshBasicMaterial({
        color: c.pitGlow,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(x, 0.05, z);
    this.sm.add(this.ring);

    // Pit/worker label ("A", "B", ...).
    this.label = makeLabelSprite(String.fromCharCode(65 + this.index));
    this.label.position.set(x, 3.0, z);
    this.label.visible = false;
    this.sm.add(this.label);
  }

  update(dt, pit) {
    // Reveal lot / station and animate their appearance.
    const lotVisible = pit.roomUnlocked && !pit.equipped;
    this.lot.visible = lotVisible;
    this.station.visible = pit.equipped;
    this.label.visible = pit.roomUnlocked;

    const lotTarget = lotVisible ? 1 : 0;
    const stationTarget = pit.equipped ? 1 : 0;
    const k = Math.min(1, 9 * dt);
    this.lotScale += (lotTarget - this.lotScale) * k;
    this.stationScale += (stationTarget - this.stationScale) * k;
    applyAppear(this.lot, this.lotScale);
    applyAppear(this.station, this.stationScale);

    // Spawn this pit's worker the moment one is hired.
    if (pit.hasMechanic && !this.mechanic) {
      this.mechanic = new Mechanic(this.pos, this.gltf);
      this.sm.add(this.mechanic.root);
    }
    if (this.mechanic) {
      this.mechanic.update(dt, { carPresent: !!pit.car, hurrying: pit.hurryTimer > 0 });
    }

    // Highlight only when the player can usefully tap here (equipped, a car
    // present, standing here, and no worker doing it for them).
    this.highlightT += dt;
    const canTap = pit.equipped && !!pit.car && pit.playerPresent && !pit.hasMechanic;
    const target = canTap ? 0.45 + 0.22 * Math.sin(this.highlightT * 5) : 0;
    this.ring.material.opacity += (target - this.ring.material.opacity) * Math.min(1, 8 * dt);
  }
}

// Pop-in with a slight overshoot, applied to a group's scale (skips if ~0/hidden).
function applyAppear(group, s) {
  if (!group.visible) return;
  const overshoot = 1 + 0.15 * Math.sin(Math.min(1, s) * Math.PI);
  group.scale.setScalar(Math.max(0.001, s * overshoot));
}

// A camera-facing text label rendered to a small canvas texture.
function makeLabelSprite(text) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = settings.colors.label;
  ctx.font = '800 96px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, size / 2, size / 2 + 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.2, 1.2, 1.2);
  return sprite;
}
