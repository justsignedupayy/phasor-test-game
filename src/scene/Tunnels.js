import * as THREE from 'three';
import settings from '../config/settings.js';

export class Tunnels {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.group = new THREE.Group();

    const T = settings.tunnel;
    const S = settings.supermarket;

    this.frameMat = new THREE.MeshStandardMaterial({ color: settings.colors.wall });
    this.interiorMat = new THREE.MeshStandardMaterial({ color: T.interiorColor });
    this.dirtMat = new THREE.MeshStandardMaterial({ color: T.dirtColor });

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
    addBox(t, height, depth, -(width / 2 + t / 2), height / 2, zMid, this.frameMat);
    addBox(t, height, depth, width / 2 + t / 2, height / 2, zMid, this.frameMat);
    addBox(width + 2 * t, t, depth, 0, height + t / 2, zMid, this.frameMat);
    addBox(width + 2 * t, height + t, t, 0, (height + t) / 2, depth + t / 2, this.interiorMat);

    g.position.set(mouth.x, T.yOffset, mouth.z);
    return g;
  }

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

  update(state) {
    const open = state.supermarket.unlocked;
    for (const p of this.parts) p.visible = open;
  }
}
