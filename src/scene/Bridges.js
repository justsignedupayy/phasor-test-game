import * as THREE from 'three';
import settings from '../config/settings.js';
import { laneBridgeCrossings, pumpSpineLayout } from '../core/roads.js';

/**
 * Bridges — the render layer for the car-lane crossings from core/roads.js,
 * from simple primitives in the grey road palette. Purely visual: the walkable
 * gap is carved out of the collision in core (pitLaneBoxes / pumpLaneBoxes);
 * this class only draws. Character.js lifts the player model by
 * core/roads.laneBridgeElevationAt while crossing; cars tween through
 * underneath, unaffected.
 *
 * PITS: one small standalone bridge per equipped pit's lane — ramp up, flat
 * deck, ramp down along x, near its hire marker. The ramps are railed down
 * both slope edges (solid twins in core/roads.pitLaneBoxes), so each ramp is
 * enterable only from its ground-level mouth, like the pump spurs.
 *
 * PUMPS: one elevated SPINE at constant bridge height along the whole row
 * (never dipping between pumps), with a perpendicular stair-like SPUR
 * descending to grade at each pump — the spur mouths are the only ways on or
 * off (every railing here has a solid twin in core/roads.pumpLaneBoxes).
 * Geometry comes from core/roads.pumpSpineLayout, one abutting deck piece per
 * pump so each stretch appears with its pump's equip; a piece's inner
 * grow-end shows a frontier end rail only while the neighbouring piece is
 * missing, and the spine's two outer ends close behind fixed end rails.
 *
 * All dimensions come from settings.pitLane (shared by both lane kinds).
 */
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
    // Each piece shows with its lane's walls (equipped — the same gate
    // core/collision uses for the wall boxes); frontier end rails show only
    // while the neighbouring piece is missing (mirroring the temporary cap
    // boxes core/roads.pumpLaneBoxes emits from its neighbour flags).
    for (const { c, group } of this.laneBridges) group.visible = state.pits[c.index].equipped;
    const pumps = state.gasStation.pumps;
    for (const seg of this.pumpSegments) {
      seg.group.visible = pumps[seg.index].equipped;
      if (seg.capHi) seg.capHi.visible = !pumps[seg.index - 1].equipped;
      if (seg.capLo) seg.capLo.visible = !pumps[seg.index + 1].equipped;
    }
  }

  /** A pit's standalone bridge: deck over the lane + a ramp down each side. */
  #buildLaneBridge(c) {
    const group = new THREE.Group();
    this.#addDeck(group, c);
    this.#addRamp(group, c, -1);
    this.#addRamp(group, c, +1);
    return group;
  }

  /**
   * The pump row's spine walkway, one group per layout piece (= per pump) so
   * each stretch appears with its pump's equip. Per piece:
   *   - a flat deck at constant bridge height spanning the piece (adjacent
   *     pieces abut exactly, so the visible spine is one seamless run);
   *   - side rails: the far (-z) edge unbroken, the pump-side (+z) edge
   *     gapped only at the piece's spur junctions;
   *   - support legs flanking its own lane (clear of the cars) and under the
   *     deck at the piece ends;
   *   - the piece's spurs (spur i+1, plus spur 0 on piece 0 — the entry);
   *   - end rails across both deck ends: fixed at the spine's outer ends
   *     (garage end + the row's closed boundary end), frontier-toggled at the
   *     inner grow-ends (returned so update() can hide them once the
   *     neighbouring piece exists).
   */
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

  /** One spine rail stretch [x0, x1] atop the deck edge at z (skipped when degenerate). */
  #spineRail(group, x0, x1, z) {
    if (x1 - x0 <= 0.01) return;
    const B = settings.pitLane.bridge;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, B.railHeight, 0.1), this.railMat);
    rail.position.set((x0 + x1) / 2, B.height + B.railHeight / 2, z);
    group.add(rail);
  }

  /** A rail across a spine deck END (full corridor width) at x; side (+1 = the
   * +x end) tucks it 0.05 back over the deck. Returned so the frontier ends
   * can be shown/hidden per equip state. */
  #endRail(group, x, z, side) {
    const B = settings.pitLane.bridge;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, B.railHeight, B.width), this.railMat);
    rail.position.set(x - side * 0.05, B.height + B.railHeight / 2, z);
    group.add(rail);
    return rail;
  }

  /** A pair of thin support posts under the spine at x, one near each deck
   * edge (the strip beneath the spine is sealed ground — nothing walks here). */
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

  /** A pump spur: the steep stair-like slab descending from the spine's pump
   * (+z) edge down to grade at junction x `jx`, railed down both slope edges
   * (the rails' solid twins live in core/roads.pumpLaneBoxes) — open only at
   * its mouth and where it meets the spine. */
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

  /** Deck over the lane at crossing c, with side rails and four corner legs. */
  #addDeck(group, c) {
    const L = settings.pitLane;
    const B = L.bridge;
    const deckLen = L.halfWidth * 2; // wall face to wall face, exactly over the lane

    // Deck: its top surface sits at B.height — the exact y the player model is
    // lifted to by core/roads.laneBridgeElevationAt while crossing.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLen, B.thickness, B.width), this.deckMat);
    deck.position.set(c.x, B.height - B.thickness / 2, c.z);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

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
  }

  /** One pit-bridge end ramp on the given side (+1 / -1 in x): a tilted slab
   * running from the deck end down to the ground, matching the linear taper
   * laneBridgeElevationAt applies over rampLength, railed down both slope
   * edges (the rails' solid twins live in core/roads.pitLaneBoxes — the pump
   * spurs' pattern) — open only at its mouth and where it meets the deck. */
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
