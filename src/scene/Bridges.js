import * as THREE from 'three';
import settings from '../config/settings.js';
import { bridgeCrossings, laneBridgeCrossings } from '../core/roads.js';

/**
 * Bridges — the render layer for both kinds of road crossing from
 * core/roads.js. Purely visual: the walkable gaps are carved out of the
 * collision in core (playerRoadBoxes / pitLaneBoxes); this class only draws.
 *
 *  • EXTERIOR crosswalks (bridgeCrossings): zebra stripes painted flat on each
 *    pit exit lane / pump lane, flush with the ground — no elevation, cars
 *    drive over the paint. Shows with its lane's road slab (land/lot bought).
 *  • INTERIOR pit-lane bridges (laneBridgeCrossings): a small raised deck over
 *    each equipped pit's car lane near its hire marker — ramp up, flat
 *    platform, ramp down along x, from simple primitives in the grey road
 *    palette. Character.js lifts the player model by
 *    core/roads.laneBridgeElevationAt while crossing; cars tween through
 *    underneath, unaffected. Shows once its pit is equipped.
 *
 * All dimensions come from settings.bridges / settings.pitLane.
 */
export class Bridges {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.crossings = [];
    this.laneBridges = [];
    // Painted road marking, like the garage roads' lane dashes — unlit.
    this.stripeMat = new THREE.MeshBasicMaterial({ color: settings.bridges.stripeColor });
    this.deckMat = new THREE.MeshStandardMaterial({ color: settings.pitLane.bridge.deckColor, flatShading: true });
    this.railMat = new THREE.MeshStandardMaterial({ color: settings.pitLane.bridge.railColor, flatShading: true });
    for (const c of bridgeCrossings()) {
      const group = this.#buildCrosswalk(c);
      this.sm.add(group);
      this.crossings.push({ c, group });
    }
    for (const c of laneBridgeCrossings()) {
      const group = this.#buildLaneBridge(c);
      this.sm.add(group);
      this.laneBridges.push({ c, group });
    }
  }

  update(state) {
    // Each exterior crosswalk shows exactly when its lane's road slab does.
    for (const { c, group } of this.crossings) {
      group.visible =
        c.kind === 'pit'
          ? state.pits[c.index].roomUnlocked
          : state.gasStation.pumps[c.index].roomUnlocked;
    }
    // Each interior lane bridge shows with its pit's lane walls (equipped —
    // the same gate core/collision uses for the wall boxes).
    for (const { c, group } of this.laneBridges) {
      group.visible = state.pits[c.index].equipped;
    }
  }

  #buildCrosswalk(c) {
    const B = settings.bridges;
    const group = new THREE.Group();
    const len = c.xMax - c.xMin;

    // Zebra stripes: thin bands elongated along the cars' travel (z), repeated
    // across the lane (x). Evenly distributed over the full lane width so
    // adjacent lanes' crosswalks read as one continuous crossing.
    const n = Math.max(2, Math.round(len / B.stripeSpacing));
    const geom = new THREE.PlaneGeometry(B.stripeWidth, B.deckWidth);
    for (let i = 0; i < n; i++) {
      const stripe = new THREE.Mesh(geom, this.stripeMat);
      const x = c.xMin + (len * (i + 0.5)) / n;
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, 0.014, c.z); // just above the road (0.006) and its dashes (0.0125)
      group.add(stripe);
    }

    return group;
  }

  #buildLaneBridge(c) {
    const L = settings.pitLane;
    const B = L.bridge;
    const group = new THREE.Group();
    const deckLen = L.halfWidth * 2; // wall face to wall face, exactly over the lane

    // Deck: its top surface sits at B.height — the exact y the player model is
    // lifted to by core/roads.laneBridgeElevationAt while crossing.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLen, B.thickness, B.width), this.deckMat);
    deck.position.set(c.x, B.height - B.thickness / 2, c.z);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    // End ramps: tilted slabs running from each deck end down to the ground,
    // matching the linear taper laneBridgeElevationAt applies over rampLength.
    const rampLen = Math.hypot(B.rampLength, B.height);
    const tilt = Math.atan2(B.height, B.rampLength);
    for (const side of [-1, 1]) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, B.thickness, B.width), this.deckMat);
      ramp.position.set(c.x + side * (L.halfWidth + B.rampLength / 2), (B.height - B.thickness) / 2, c.z);
      ramp.rotation.z = -side * tilt; // descend away from the deck
      ramp.castShadow = true;
      group.add(ramp);
    }

    // Side rails along the deck (visual guard — the lane walls' carved gap is
    // what actually keeps the player from stepping off over the lane).
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(deckLen, B.railHeight, 0.1), this.railMat);
      rail.position.set(c.x, B.height + B.railHeight / 2, c.z + side * (B.width / 2 - 0.05));
      group.add(rail);
    }

    // Four corner legs — thin posts just OUTSIDE the lane edges (under each
    // ramp's high end), so the cars passing under the deck stay clear of them.
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

    return group;
  }
}
