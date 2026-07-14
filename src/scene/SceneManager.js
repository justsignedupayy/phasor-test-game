import * as THREE from 'three';
import settings from '../config/settings.js';

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

    this.moveBasis = this.#computeMoveBasis();

    this._onResize = this.#onResize.bind(this);
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(this._onResize);
      this._resizeObserver.observe(container);
    }
    window.addEventListener('resize', this._onResize);
    window.visualViewport?.addEventListener('resize', this._onResize);
    this.#onResize();
  }

  #createCamera() {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, settings.camera.near, settings.camera.far);
    const d = settings.camera.distance;
    cam.position.set(d, d, d);
    cam.lookAt(0, 0, 0);
    return cam;
  }

  follow(x, z, dt) {
    const d = settings.camera.distance;
    if (this.isPortrait) z -= settings.camera.portraitZBias;
    if (!this.camTarget) this.camTarget = new THREE.Vector3(x, 0, z); // snap on first frame
    const k = Math.min(1, settings.camera.followLerp * dt);
    this.camTarget.x += (x - this.camTarget.x) * k;
    this.camTarget.z += (z - this.camTarget.z) * k;
    this.camera.position.set(this.camTarget.x + d, d, this.camTarget.z + d);
    this.camera.lookAt(this.camTarget);

    this.dirLight.position.set(
      this.camTarget.x + this.dirOffset.x,
      this.dirOffset.y,
      this.camTarget.z + this.dirOffset.z
    );
    this.dirLight.target.position.set(this.camTarget.x, 0, this.camTarget.z);
  }

  #addLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff5e0, 0xa89c85, 1.15));

    const dir = new THREE.DirectionalLight(0xfff0cc, 2.9);
    this.dirOffset = new THREE.Vector3(12, 16, 8); // key direction; follow() keeps it relative to the view
    dir.position.copy(this.dirOffset);
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
    this.dirLight = dir;

    const fill = new THREE.DirectionalLight(0xddeeff, 0.45);
    fill.position.set(-8, 10, -6);
    this.scene.add(fill);
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
    const vv = window.visualViewport;
    console.log(
      `[resize] container ${this.container.clientWidth}x${this.container.clientHeight}, ` +
        `window ${window.innerWidth}x${window.innerHeight}, ` +
        `visualViewport ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}` : 'n/a'}, ` +
        `dpr ${window.devicePixelRatio} -> renderer ${w}x${h}`
    );
    if (!w || !h) return;
    const aspect = w / h;
    const half = settings.camera.viewSize / 2;
    this.isPortrait = aspect < 1;
    if (aspect >= 1) {
      const grow = Math.min(aspect, settings.camera.maxAspectGrow);
      const hHalf = half * grow;
      const vHalf = hHalf / aspect; // = half while under the clamp (grow === aspect)
      this.camera.left = -hHalf;
      this.camera.right = hHalf;
      this.camera.top = vHalf;
      this.camera.bottom = -vHalf;
    } else {
      const stretch = Math.min(1 / aspect, settings.camera.portraitMaxStretch);
      const vHalf = (half * stretch) / settings.camera.portraitZoom;
      const hHalf = vHalf * aspect; // = half/zoom while under the clamp (stretch === 1/aspect)
      this.camera.left = -hHalf;
      this.camera.right = hHalf;
      this.camera.top = vHalf;
      this.camera.bottom = -vHalf;
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
