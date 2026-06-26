import * as THREE from 'three';
import settings from '../config/settings.js';
import { Mechanic } from './Mechanic.js';
import { cloneStorageModel } from './StorageModels.js';

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

    // Break chair: appears once this pit has a hired worker, swapped for a couch
    // when its break room is upgraded. chairPos is where the worker walks to sit.
    const B = settings.breaks;
    this.chairPos = { x: this.pos.x + B.chairOffset.x, z: this.pos.z + B.chairOffset.z };
    this.seat = null; // the Chair/couch clone (tapped to open the break UI while seated)
    this._seatModelKey = null; // 'chair' | 'couch' — current seat model, for swap detection

    this.boxes = []; // decorative shelf-box clones (a full grid; always shown when equipped)
    this.travelBoxes = []; // boxes currently riding the conveyor belt (one per delivery)
    this._labelText = ''; // last storage-label text drawn (skip redraw if unchanged)
    this._prevTires = undefined; // for detecting a conveyor delivery (tires 0 → full)

    this.#build();
    this.#buildStorage();
  }

  #build() {
    const c = settings.colors;
    const { x, z } = this.pos;

    // Empty lot: a faint floor patch + an outline ring.
    this.lot = new THREE.Group();
    this.lot.position.set(x, 0, z);
    this.lot.visible = false;
    this.sm.add(this.lot);

    // Equipped station: brown pit floor + a toolbox marker.
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

  /**
   * The per-pit storage props: a shelf of boxes (player carries one to the
   * worker to refill tires), the tire stack beside the worker, the conveyor
   * that automates that delivery, and a live "tires / boxes" label. All hidden
   * until the pit is equipped; the conveyor also needs state.hasConveyor.
   */
  #buildStorage() {
    const { x, z } = this.pos;
    const S = settings.storage;

    // Shelf (exit-door side of the pit), with its boxes stacked as children so
    // they ride along with the shelf transform.
    this.shelf = cloneStorageModel('shelf');
    this.shelf.scale.setScalar(S.shelfScale);
    this.shelf.position.set(x + S.shelfOffset.x, 0, z + S.shelfOffset.z);
    this.shelf.visible = false;
    this.sm.add(this.shelf);

    // Decorative box stock: a full 3-wide grid (x axis) that stacks upward (y
    // axis), at 1/5 the carried-box scale. Always shown when equipped.
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

    // Tire stack beside the worker.
    this.tires = cloneStorageModel('tires');
    this.tires.scale.setScalar(S.tireScale);
    this.tires.position.set(x + S.tireOffset.x, 0, z + S.tireOffset.z);
    this.tires.visible = false;
    this.sm.add(this.tires);

    // Conveyor spanning shelf → worker (a physical-looking barrier in the path).
    this.conveyor = cloneStorageModel('conveyor');
    this.conveyor.scale.setScalar(S.conveyorScale);
    this.conveyor.position.set(x + S.conveyorOffset.x, 0, z + S.conveyorOffset.z);
    this.conveyor.rotation.y = S.conveyorRotation;
    this.conveyor.visible = false;
    this.sm.add(this.conveyor);

    // Precompute the belt's world footprint as an axis-aligned rectangle (the
    // mesh transform is static). Core reads this off pit.conveyorBounds to block
    // the player from walking through it. The AABB folds in the Y-rotation.
    this.conveyor.updateWorldMatrix(true, true);
    const cbox = new THREE.Box3().setFromObject(this.conveyor);
    this._conveyorBounds = {
      x: (cbox.min.x + cbox.max.x) / 2,
      z: (cbox.min.z + cbox.max.z) / 2,
      halfX: (cbox.max.x - cbox.min.x) / 2,
      halfZ: (cbox.max.z - cbox.min.z) / 2,
    };

    // Live "Tires N" label, just above the letter label.
    this.storageLabel = makeStorageSprite();
    this.storageLabel.position.set(x, 3.7, z);
    this.storageLabel.visible = false;
    this.sm.add(this.storageLabel);
  }

  /** Reflect this pit's tire/box/conveyor state into the storage props each frame. */
  #updateStorage(dt, pit, state) {
    const equipped = pit.equipped;
    this.shelf.visible = equipped;
    this.tires.visible = equipped && pit.tiresRemaining > 0;
    this.conveyor.visible = equipped && state.hasConveyor;
    this.storageLabel.visible = equipped;

    // Hand core the belt's footprint for player collision — only while it's
    // actually present (equipped + conveyor owned), null otherwise.
    pit.conveyorBounds = this.conveyor.visible ? this._conveyorBounds : null;

    // Shelf stock is decorative: always show the full grid when equipped, never
    // remove boxes as shelfBoxes drops.
    for (const box of this.boxes) box.visible = equipped;

    // A conveyor delivery refills a fully-dry pit (tires 0 → full) on its timer
    // — shelf stock is infinite, so the only signal is that 0→full jump while
    // the conveyor is owned. When it happens, send a box riding down the belt.
    if (state.hasConveyor && this._prevTires === 0 && pit.tiresRemaining > this._prevTires) {
      this.#launchTravelBox();
    }
    this._prevTires = pit.tiresRemaining;
    this.#updateTravelBoxes(dt);

    if (equipped) {
      const text = `Tires ${pit.tiresRemaining}`;
      if (text !== this._labelText) {
        this._labelText = text;
        drawStorageSprite(this.storageLabel, text);
      }
    }
  }

  /**
   * Spawn one box that rides the conveyor belt end-to-end; #updateTravelBoxes
   * drives it. The path is anchored on the conveyor mesh's actual world position
   * and runs strictly along the belt's own facing axis (its longest horizontal
   * local axis), staying at conveyorBeltY the whole way — so the box follows the
   * belt surface instead of cutting a diagonal through the air to the worker.
   */
  #launchTravelBox() {
    const S = settings.storage;
    this.conveyor.updateWorldMatrix(true, true);
    const beltPos = this.conveyor.getWorldPosition(new THREE.Vector3());
    const q = this.conveyor.getWorldQuaternion(new THREE.Quaternion());

    // The belt runs along whichever of its local horizontal axes is longest;
    // travel strictly along that one (the direction the belt faces).
    const size = new THREE.Box3().setFromObject(this.conveyor).getSize(new THREE.Vector3());
    const axisX = new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize();
    const axisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const extentX = Math.abs(axisX.x) * size.x + Math.abs(axisX.z) * size.z;
    const extentZ = Math.abs(axisZ.x) * size.x + Math.abs(axisZ.z) * size.z;
    const axis = extentX >= extentZ ? axisX : axisZ;
    const halfLen = 0.5 * Math.max(extentX, extentZ);

    // Orient the axis so the box ends nearer the worker (shelf end → worker end).
    const m = settings.mechanic;
    const toWorker = new THREE.Vector3(this.pos.x + m.offsetX - beltPos.x, 0, this.pos.z + m.offsetZ - beltPos.z);
    if (axis.dot(toWorker) < 0) axis.negate();

    const from = new THREE.Vector3(beltPos.x - axis.x * halfLen, S.conveyorBeltY, beltPos.z - axis.z * halfLen);
    const to = new THREE.Vector3(beltPos.x + axis.x * halfLen, S.conveyorBeltY, beltPos.z + axis.z * halfLen);

    const mesh = cloneStorageModel('box');
    mesh.scale.setScalar(S.boxScale); // original (non-shelf) scale, so it reads as a real box
    mesh.position.copy(from);
    this.sm.add(mesh);
    this.travelBoxes.push({ mesh, t: 0, from, to });
  }

  /** Advance each in-flight belt box shelf→worker; dispose it on arrival. */
  #updateTravelBoxes(dt) {
    const dur = settings.storage.conveyorTravelDuration;
    for (let i = this.travelBoxes.length - 1; i >= 0; i--) {
      const b = this.travelBoxes[i];
      b.t = Math.min(1, b.t + dt / dur);
      b.mesh.position.lerpVectors(b.from, b.to, b.t);
      if (b.t >= 1) {
        disposeStorageMesh(this.sm, b.mesh);
        this.travelBoxes.splice(i, 1);
      }
    }
  }

  /**
   * Build (or swap) this pit's break seat: a Chair by default, a couch once the
   * break room is upgraded. Cloned/disposed the same way as the storage props.
   */
  #ensureSeat(upgraded) {
    const key = upgraded ? 'couch' : 'chair';
    if (this._seatModelKey === key) return;
    if (this.seat) disposeStorageMesh(this.sm, this.seat);
    const B = settings.breaks;
    const seat = cloneStorageModel(key);
    seat.scale.setScalar(upgraded ? B.couchScale : B.chairScale);
    seat.position.set(this.chairPos.x, 0, this.chairPos.z);
    seat.rotation.y = B.chairFacing;
    this.sm.add(seat);
    this.seat = seat;
    this._seatModelKey = key;
  }

  update(dt, pit, state) {
    this.#updateStorage(dt, pit, state);

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

    // Spawn this pit's worker (and its break chair) the moment one is hired.
    if (pit.hasMechanic && !this.mechanic) {
      this.mechanic = new Mechanic(this.pos, this.gltf);
      this.sm.add(this.mechanic.root);
    }
    if (pit.hasMechanic) this.#ensureSeat(pit.break.breakDurationUpgraded);
    if (this.mechanic) {
      const B = settings.breaks;
      this.mechanic.update(dt, {
        carPresent: !!pit.car,
        hurrying: pit.hurryTimer > 0,
        onBreak: pit.break.onBreak,
        chairPos: this.chairPos,
        chairFacing: B.chairFacing,
        seatOffset: pit.break.breakDurationUpgraded ? B.sitOffset.couch : B.sitOffset.chair,
      });
    }

    // Highlight only when the player can usefully tap here (equipped, a car
    // present, standing here, and no worker doing it for them).
    this.highlightT += dt;
    const canTap = pit.equipped && !!pit.car && pit.playerPresent && !pit.hasMechanic;
    const target = canTap ? 0.45 + 0.22 * Math.sin(this.highlightT * 5) : 0;
    this.ring.material.opacity += (target - this.ring.material.opacity) * Math.min(1, 8 * dt);
  }
}

// Remove a cloned storage mesh from the scene and free its geometry/materials
// (materials are per-clone — see cloneStorageModel — so disposing is safe).
function disposeStorageMesh(sceneManager, mesh) {
  sceneManager.remove(mesh);
  mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((mt) => mt.dispose());
    }
  });
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

// A wide canvas-textured sprite for the live "Tires N · Box M" readout. The
// canvas is created once; drawStorageSprite() repaints it when the text changes.
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
  ctx.font = '800 34px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  sprite.userData.tex.needsUpdate = true;
}
