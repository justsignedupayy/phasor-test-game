import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * Tunnels — static, purely-visual portal props at the supermarket's customer
 * ENTRY and EXIT, so customers read as EMERGING from / VANISHING into a tunnel
 * rather than popping in/out in the open. No collision, no logic: a customer
 * still becomes active / is removed at the same core position as before — those
 * spawn/despawn points are simply placed INSIDE the dark interior now (see
 * settings.supermarket.customerEntry/ExitOutside), so the appearance/removal is
 * hidden by the tunnel.
 *
 * Each mouth opens toward -z (toward the corridor door); the tunnel body runs +z
 * behind it and is capped by a dark back wall, and a short brown dirt path links
 * the mouth back to the door (customerDoorZ) so the customer visibly walks the
 * path between tunnel and door. The frame matches the building walls
 * (settings.colors.wall); dimensions/colours are settings.tunnel. Both props are
 * shown once the market is open (update(state)).
 */
export class Tunnels {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.group = new THREE.Group();

    const T = settings.tunnel;
    const S = settings.supermarket;

    // Frame = building walls; interior = its own near-black; path = brown dirt.
    this.frameMat = new THREE.MeshStandardMaterial({ color: settings.colors.wall });
    this.interiorMat = new THREE.MeshStandardMaterial({ color: T.interiorColor });
    this.dirtMat = new THREE.MeshStandardMaterial({ color: T.dirtColor });

    // One tunnel at each customer door, anchored on its mouth centre, plus a dirt
    // path from that mouth back to the corridor door.
    this.entry = this.#buildTunnel(S.customerEntryTunnelMouth, T.customer);
    this.exit = this.#buildTunnel(S.customerExitTunnelMouth, T.customer);
    this.entryPath = this.#buildDirtPath(S.customerEntryTunnelMouth, S.customerDoorZ);
    this.exitPath = this.#buildDirtPath(S.customerExitTunnelMouth, S.customerDoorZ);

    this.parts = [this.entry, this.exit, this.entryPath, this.exitPath];
    for (const p of this.parts) {
      p.visible = false;
      this.group.add(p);
    }
    this.sm.add(this.group);
  }

  /**
   * One portal centred on `mouth` in x, its open mouth at mouth.z and its body
   * running +z (behind the door side) for `dims.depth`, closed there by a dark wall.
   */
  #buildTunnel(mouth, dims) {
    const T = settings.tunnel;
    const t = T.wallThickness;
    const { width, height, depth } = dims;
    const g = new THREE.Group();

    const addBox = (w, h, d, x, y, z, mat) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      box.position.set(x, y, z);
      g.add(box);
    };

    const zMid = depth / 2; // body spans z:[0, depth]; mouth (open) at z=0, back at z=depth
    // Side walls flanking the opening, running the tunnel's full depth.
    addBox(t, height, depth, -(width / 2 + t / 2), height / 2, zMid, this.frameMat);
    addBox(t, height, depth, width / 2 + t / 2, height / 2, zMid, this.frameMat);
    // Roof spanning the opening (+ both side walls), capping the mouth.
    addBox(width + 2 * t, t, depth, 0, height + t / 2, zMid, this.frameMat);
    // Dark back wall closing the far (+z) end so the mouth reads as a dark recess.
    // Butted JUST BEHIND the frame (z:[depth, depth+t]) rather than inside it —
    // sharing the side walls' z=depth / y=height+t faces would z-fight.
    addBox(width + 2 * t, height + t, t, 0, (height + t) / 2, depth + t / 2, this.interiorMat);

    g.position.set(mouth.x, T.yOffset, mouth.z);
    return g;
  }

  /** A flat brown dirt strip along x=mouth.x, spanning z from the door to the mouth. */
  #buildDirtPath(mouth, doorZ) {
    const T = settings.tunnel;
    const z0 = Math.min(doorZ, mouth.z);
    const z1 = Math.max(doorZ, mouth.z);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(T.pathWidth, z1 - z0), this.dirtMat);
    path.rotation.x = -Math.PI / 2;
    path.position.set(mouth.x, 0.02, (z0 + z1) / 2); // just above the exterior grass
    path.receiveShadow = true;
    return path;
  }

  /** Both tunnels + their paths appear with the supermarket. */
  update(state) {
    const open = state.supermarket.unlocked;
    for (const p of this.parts) p.visible = open;
  }
}
