import * as THREE from 'three';
import settings from '../config/settings.js';
import { bridgeCrossings } from '../core/roads.js';

/**
 * Bridges — the pedestrian bridges' render layer: one deck with end ramps,
 * side rails and support legs per crossing from core/roads.bridgeCrossings.
 * Purely visual: the walkable corridor is carved out of the road collision in
 * core/roads.playerRoadBoxes, and Character.js lifts the player model by
 * core/roads.bridgeElevationAt — this class only draws the structures and
 * gates each bridge's visibility to its road system existing (see update()).
 * All dimensions come from settings.bridges.
 */
export class Bridges {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.groups = {};
    this.deckMat = new THREE.MeshStandardMaterial({ color: settings.bridges.deckColor, flatShading: true });
    this.railMat = new THREE.MeshStandardMaterial({ color: settings.bridges.railColor, flatShading: true });
    for (const c of bridgeCrossings()) {
      const group = this.#build(c);
      this.sm.add(group);
      this.groups[c.name] = group;
    }
  }

  update(state) {
    // The garage entry/exit bridges stand from the start (pit 0's roads exist
    // on a fresh save); the delivery and gas bridges appear with their roads.
    this.groups.delivery.visible = state.supermarket.unlocked;
    this.groups.gas.visible = state.gasStation.pumps[0].roomUnlocked;
  }

  #build(c) {
    const B = settings.bridges;
    const group = new THREE.Group();
    const len = c.xMax - c.xMin;
    const midX = (c.xMin + c.xMax) / 2;

    // Deck: its top surface sits at deckHeight — the exact y the player model
    // is lifted to by core/roads.bridgeElevationAt while crossing.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, B.deckThickness, B.deckWidth), this.deckMat);
    deck.position.set(midX, B.deckHeight - B.deckThickness / 2, c.z);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    // End ramps: tilted slabs running from each deck end down to the ground,
    // matching the linear taper bridgeElevationAt applies over rampLength.
    const rampLen = Math.hypot(B.rampLength, B.deckHeight);
    const tilt = Math.atan2(B.deckHeight, B.rampLength);
    for (const side of [-1, 1]) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, B.deckThickness, B.deckWidth), this.deckMat);
      const edgeX = side < 0 ? c.xMin : c.xMax;
      ramp.position.set(edgeX + side * (B.rampLength / 2), (B.deckHeight - B.deckThickness) / 2, c.z);
      ramp.rotation.z = -side * tilt; // descend away from the deck
      ramp.castShadow = true;
      group.add(ramp);
    }

    // Side rails along the deck (visual guard — the carved road boxes are what
    // actually keep the player from stepping off over a lane).
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, B.railHeight, 0.12), this.railMat);
      rail.position.set(midX, B.deckHeight + B.railHeight / 2, c.z + side * (B.deckWidth / 2 - 0.06));
      group.add(rail);
    }

    // Support legs: a pair at each end and roughly every legSpacing along the
    // deck. They land on lane verges/boundaries — far narrower than a lane, so
    // cars visually pass between them.
    const legH = B.deckHeight - B.deckThickness;
    const legGeom = new THREE.BoxGeometry(0.35, legH, 0.35);
    const spans = Math.max(1, Math.round(len / B.legSpacing));
    for (let i = 0; i <= spans; i++) {
      const x = c.xMin + (len * i) / spans;
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(legGeom, this.railMat);
        leg.position.set(x, legH / 2, c.z + side * (B.deckWidth / 2 - 0.25));
        leg.castShadow = true;
        group.add(leg);
      }
    }

    return group;
  }
}
