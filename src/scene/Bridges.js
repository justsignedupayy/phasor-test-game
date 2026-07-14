import * as THREE from 'three';
import settings from '../config/settings.js';
import { laneBridgeCrossings, pumpSpineLayout } from '../core/roads.js';

export class Bridges {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.laneBridges = []; // per-pit standalone bridges
    this.pumpSegments = []; // the pump spine, one gated piece per pump
    this.deckMat = new THREE.MeshStandardMaterial({ color: settings.pitLane.bridge.deckColor, flatShading: true });
    this.railMat = new THREE.MeshStandardMaterial({ color: settings.pitLane.bridge.railColor, flatShading: true });
    for (const c of laneBridgeCrossings()) {
      const group = this.#buildLaneBridge(c);
      this.sm.add(group);
      this.laneBridges.push({ c, group });
    }
    this.#buildPumpWalkway();
  }

  update(state) {
    for (const { c, group } of this.laneBridges) group.visible = state.pits[c.index].equipped;
    const pumps = state.gasStation.pumps;
    for (const seg of this.pumpSegments) {
      seg.group.visible = pumps[seg.index].equipped;
      if (seg.capHi) seg.capHi.visible = !pumps[seg.index - 1].equipped;
      if (seg.capLo) seg.capLo.visible = !pumps[seg.index + 1].equipped;
    }
  }

  #buildLaneBridge(c) {
    const group = new THREE.Group();
    this.#addDeck(group, c);
    this.#addRamp(group, c, -1);
    this.#addRamp(group, c, +1);
    return group;
  }

  #buildPumpWalkway() {
    const L = settings.pitLane;
    const B = L.bridge;
    const S = L.spine;
    const spine = pumpSpineLayout();
    const railInset = B.width / 2 - 0.05;
    const last = spine.pieces.length - 1;
    for (const piece of spine.pieces) {
      const group = new THREE.Group();

      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(piece.xMax - piece.xMin, B.thickness, B.width),
        this.deckMat
      );
      deck.position.set((piece.xMin + piece.xMax) / 2, B.height - B.thickness / 2, spine.z);
      deck.castShadow = true;
      deck.receiveShadow = true;
      group.add(deck);

      this.#spineRail(group, piece.xMin, piece.xMax, spine.z - railInset);
      let a = piece.xMin;
      for (const jx of piece.spurs.map((j) => spine.junctions[j]).sort((q, w) => q - w)) {
        this.#spineRail(group, a, jx - S.spurWidth / 2, spine.z + railInset);
        a = jx + S.spurWidth / 2;
      }
      this.#spineRail(group, a, piece.xMax, spine.z + railInset);

      const px = settings.gasStation.positions[piece.index].x;
      for (const x of [px - L.halfWidth - 0.1, px + L.halfWidth + 0.1, piece.xMin + 0.2, piece.xMax - 0.2]) {
        this.#addLegs(group, x, spine.z);
      }

      for (const j of piece.spurs) this.#addSpur(group, spine.junctions[j], spine.z);

      const railHi = this.#endRail(group, piece.xMax, spine.z, +1);
      const railLo = this.#endRail(group, piece.xMin, spine.z, -1);
      this.sm.add(group);
      this.pumpSegments.push({
        index: piece.index,
        group,
        capHi: piece.index === 0 ? null : railHi, // frontier toward piece i-1
        capLo: piece.index === last ? null : railLo, // frontier toward piece i+1
      });
    }
  }

  #spineRail(group, x0, x1, z) {
    if (x1 - x0 <= 0.01) return;
    const B = settings.pitLane.bridge;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, B.railHeight, 0.1), this.railMat);
    rail.position.set((x0 + x1) / 2, B.height + B.railHeight / 2, z);
    group.add(rail);
  }

  #endRail(group, x, z, side) {
    const B = settings.pitLane.bridge;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, B.railHeight, B.width), this.railMat);
    rail.position.set(x - side * 0.05, B.height + B.railHeight / 2, z);
    group.add(rail);
    return rail;
  }

  #addLegs(group, x, z) {
    const B = settings.pitLane.bridge;
    const legH = B.height - B.thickness;
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, legH, 0.18), this.railMat);
      leg.position.set(x, legH / 2, z + sz * (B.width / 2 - 0.12));
      leg.castShadow = true;
      group.add(leg);
    }
  }

  #addSpur(group, jx, spineZ) {
    const B = settings.pitLane.bridge;
    const S = settings.pitLane.spine;
    const slopeLen = Math.hypot(S.spurLength, B.height);
    const tilt = Math.atan2(B.height, S.spurLength);
    const spur = new THREE.Group();
    spur.position.set(jx, (B.height - B.thickness) / 2, spineZ + B.width / 2 + S.spurLength / 2);
    spur.rotation.x = tilt; // descend away from the spine, down toward the pump's ground
    const slab = new THREE.Mesh(new THREE.BoxGeometry(S.spurWidth, B.thickness, slopeLen), this.deckMat);
    slab.castShadow = true;
    spur.add(slab);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, B.railHeight, slopeLen), this.railMat);
      rail.position.set(s * (S.spurWidth / 2 - 0.05), B.thickness / 2 + B.railHeight / 2, 0);
      spur.add(rail);
    }
    group.add(spur);
  }

  #addDeck(group, c) {
    const L = settings.pitLane;
    const B = L.bridge;
    const deckLen = L.halfWidth * 2; // wall face to wall face, exactly over the lane

    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLen, B.thickness, B.width), this.deckMat);
    deck.position.set(c.x, B.height - B.thickness / 2, c.z);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(deckLen, B.railHeight, 0.1), this.railMat);
      rail.position.set(c.x, B.height + B.railHeight / 2, c.z + side * (B.width / 2 - 0.05));
      group.add(rail);
    }

    const legH = B.height - B.thickness;
    const legGeom = new THREE.BoxGeometry(0.18, legH, 0.18);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(legGeom, this.railMat);
        leg.position.set(c.x + sx * (L.halfWidth + 0.1), legH / 2, c.z + sz * (B.width / 2 - 0.12));
        leg.castShadow = true;
        group.add(leg);
      }
    }
  }

  #addRamp(group, c, side) {
    const L = settings.pitLane;
    const B = L.bridge;
    const rampLen = Math.hypot(B.rampLength, B.height);
    const tilt = Math.atan2(B.height, B.rampLength);
    const ramp = new THREE.Group();
    ramp.position.set(c.x + side * (L.halfWidth + B.rampLength / 2), (B.height - B.thickness) / 2, c.z);
    ramp.rotation.z = -side * tilt; // descend away from the deck
    const slab = new THREE.Mesh(new THREE.BoxGeometry(rampLen, B.thickness, B.width), this.deckMat);
    slab.castShadow = true;
    ramp.add(slab);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(rampLen, B.railHeight, 0.1), this.railMat);
      rail.position.set(0, B.thickness / 2 + B.railHeight / 2, s * (B.width / 2 - 0.05));
      ramp.add(rail);
    }
    group.add(ramp);
  }
}
