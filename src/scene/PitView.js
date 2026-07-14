import * as THREE from 'three';
import settings from '../config/settings.js';
import { Mechanic } from './Mechanic.js';
import { cloneStorageModel } from './StorageModels.js';

export class PitView {
  constructor(sceneManager, index, gltf) {
    this.sm = sceneManager;
    this.index = index;
    this.pos = settings.pit.positions[index];
    this.gltf = gltf; // shared character model + clips, passed to this pit's Mechanic when hired

    this.mechanic = null;
    this.highlightT = 0;
    this.stationScale = 0; // animated 0..1

    this.boxes = []; // decorative shelf-box clones (a full grid; always shown when equipped)
    this._labelText = ''; // last storage-label text drawn (skip redraw if unchanged)

    this.#build();
    this.#buildStorage();
  }

  #build() {
    const c = settings.colors;
    const { x, z } = this.pos;

    this.station = new THREE.Group();
    this.station.position.set(x, 0, z);
    this.station.visible = false;
    const toolbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: c.toolbox, flatShading: true })
    );
    toolbox.position.set(-1.7, 0.25, 1.3);
    toolbox.castShadow = true;
    this.station.add(toolbox);
    this.sm.add(this.station);

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

    this.label = makeLabelSprite(String.fromCharCode(65 + this.index));
    this.label.position.set(x, 3.0, z);
    this.label.visible = false;
    this.sm.add(this.label);
  }

  #buildStorage() {
    const { x, z } = this.pos;
    const S = settings.storage;

    this.shelf = cloneStorageModel('shelf');
    this.shelf.scale.setScalar(S.shelfScale);
    this.shelf.position.set(x + S.shelfOffset.x, 0, z + S.shelfOffset.z);
    this.shelf.visible = false;
    this.sm.add(this.shelf);

    const g = S.boxGrid;
    for (let i = 0; i < S.shelfCapacity; i++) {
      const box = cloneStorageModel('box');
      box.scale.setScalar(S.shelfBoxScale);
      const col = i % g.cols;
      const row = Math.floor(i / g.cols);
      box.position.set((col - (g.cols - 1) / 2) * g.spacingX, g.baseY + row * g.spacingY, 0);
      box.visible = false;
      this.shelf.add(box);
      this.boxes.push(box);
    }

    this.tires = cloneStorageModel('tires');
    this.tires.scale.setScalar(S.tireScale);
    this.tires.position.set(x + S.tireOffset.x, 0, z + S.tireOffset.z);
    this.tires.visible = false;
    this.sm.add(this.tires);

    this.storageLabel = makeStorageSprite();
    this.storageLabel.position.set(x, 3.7, z);
    this.storageLabel.visible = false;
    this.sm.add(this.storageLabel);
  }

  #updateStorage(pit) {
    const equipped = pit.equipped;
    this.shelf.visible = equipped;
    this.tires.visible = equipped && pit.tiresRemaining > 0;
    this.storageLabel.visible = equipped;

    for (const box of this.boxes) box.visible = equipped;

    if (equipped) {
      const text = `Tires ${pit.tiresRemaining}`;
      if (text !== this._labelText) {
        this._labelText = text;
        drawStorageSprite(this.storageLabel, text);
      }
    }
  }

  update(dt, pit, state) {
    this.#updateStorage(pit);

    this.station.visible = pit.equipped;
    this.label.visible = pit.roomUnlocked;

    const stationTarget = pit.equipped ? 1 : 0;
    const k = Math.min(1, 9 * dt);
    this.stationScale += (stationTarget - this.stationScale) * k;
    applyAppear(this.station, this.stationScale);

    if (pit.hasMechanic && !this.mechanic) {
      this.mechanic = new Mechanic(this.gltf);
      this.sm.add(this.mechanic.root);
    }
    if (this.mechanic && pit.mechanic) {
      const B = settings.breaks;
      this.mechanic.update(dt, {
        mechanic: pit.mechanic, // core-owned position + restock/break FSM
        carPresent: !!pit.car && pit.car.settleRemaining <= 0,
        hurrying: pit.hurryTimer > 0,
        onBreak: pit.break.onBreak,
        breakState: pit.break, // the head label's "x/y" break-progress counter
        restFacing: B.breakSpotFacing,
        leanOffset: B.leanOffset,
      });
    }

    this.highlightT += dt;
    const canTap = pit.equipped && !!pit.car && pit.playerPresent && (!pit.hasMechanic || pit.break.onBreak);
    const target = canTap ? 0.45 + 0.22 * Math.sin(this.highlightT * 5) : 0;
    this.ring.material.opacity += (target - this.ring.material.opacity) * Math.min(1, 8 * dt);
  }
}

function applyAppear(group, s) {
  if (!group.visible) return;
  const overshoot = 1 + 0.15 * Math.sin(Math.min(1, s) * Math.PI);
  group.scale.setScalar(Math.max(0.001, s * overshoot));
}

export function makeLabelSprite(text) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = settings.colors.label;
  ctx.font = `800 96px ${settings.ui.fontStack}`;
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

function makeStorageSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  return sprite;
}

function drawStorageSprite(sprite, text) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = settings.colors.label;
  ctx.font = `800 34px ${settings.ui.fontStack}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  sprite.userData.tex.needsUpdate = true;
}
