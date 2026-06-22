import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * SceneManager — owns the renderer, scene graph, isometric camera, and lights.
 * Pure rendering infrastructure: it knows nothing about game logic.
 */
export class SceneManager {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(settings.colors.background);

    this.camera = this.#createCamera();
    this.#addLights();

    // World-space ground basis derived from the camera, so screen-relative
    // joystick input can be mapped to camera-relative movement.
    this.moveBasis = this.#computeMoveBasis();

    this._onResize = this.#onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this.#onResize();
  }

  #createCamera() {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, settings.camera.near, settings.camera.far);
    const d = settings.camera.distance;
    // Equal x/y/z → ~35.26° downward tilt, 45° rotation: classic isometric.
    cam.position.set(d, d, d);
    cam.lookAt(0, 0, 0);
    return cam;
  }

  /**
   * Smoothly track a ground target (the player). Keeps the fixed isometric
   * offset (d, d, d) — only the look-at point translates — so the angle, zoom,
   * and moveBasis are unchanged; the view just pans across the larger garage.
   */
  follow(x, z, dt) {
    const d = settings.camera.distance;
    if (!this.camTarget) this.camTarget = new THREE.Vector3(x, 0, z); // snap on first frame
    const k = Math.min(1, settings.camera.followLerp * dt);
    this.camTarget.x += (x - this.camTarget.x) * k;
    this.camTarget.z += (z - this.camTarget.z) * k;
    this.camera.position.set(this.camTarget.x + d, d, this.camTarget.z + d);
    this.camera.lookAt(this.camTarget);
  }

  #addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(12, 20, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const s = 22;
    dir.shadow.camera.left = -s;
    dir.shadow.camera.right = s;
    dir.shadow.camera.top = s;
    dir.shadow.camera.bottom = -s;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 90;
    dir.shadow.bias = -0.0005;
    this.scene.add(dir);
    this.scene.add(dir.target);
  }

  #computeMoveBasis() {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward); // direction the camera looks (into scene)
    forward.y = 0;
    forward.normalize(); // = "screen up" projected onto the ground
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    return {
      forward: { x: forward.x, z: forward.z },
      right: { x: right.x, z: right.z },
    };
  }

  #onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const aspect = w / h;
    const half = settings.camera.viewSize / 2;
    // "Contain" fit: viewSize is the span of whichever axis is the binding
    // constraint. Landscape anchors the vertical span (width grows with aspect,
    // as before). Portrait anchors the same span horizontally so the wide
    // isometric world still fits across a narrow screen (height grows instead),
    // rather than cropping the leftmost pits off the side.
    if (aspect >= 1) {
      this.camera.left = -half * aspect;
      this.camera.right = half * aspect;
      this.camera.top = half;
      this.camera.bottom = -half;
    } else {
      this.camera.left = -half;
      this.camera.right = half;
      this.camera.top = half / aspect;
      this.camera.bottom = -half / aspect;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  add(object3D) {
    this.scene.add(object3D);
  }

  remove(object3D) {
    this.scene.remove(object3D);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
