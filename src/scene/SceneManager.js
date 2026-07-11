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
    // Portrait framing bias: aim a few units into the room (−z) so the
    // clamped, shallower portrait view spends its depth on the building, not
    // on symmetric grass. Applied to the DESIRED target before the ease —
    // it's a constant offset the lerp converges on (the player position is
    // already world-clamped in core, and the camera target itself is never
    // clamped), so there is nothing for it to fight at the world edges.
    if (this.isPortrait) z -= settings.camera.portraitZBias;
    if (!this.camTarget) this.camTarget = new THREE.Vector3(x, 0, z); // snap on first frame
    const k = Math.min(1, settings.camera.followLerp * dt);
    this.camTarget.x += (x - this.camTarget.x) * k;
    this.camTarget.z += (z - this.camTarget.z) * k;
    this.camera.position.set(this.camTarget.x + d, d, this.camTarget.z + d);
    this.camera.lookAt(this.camTarget);

    // The key light (and so its shadow box) rides along with the camera target
    // at a constant offset: shadows exist everywhere the camera goes, instead
    // of only inside a fixed ±22-unit box around the world origin.
    this.dirLight.position.set(
      this.camTarget.x + this.dirOffset.x,
      this.dirOffset.y,
      this.camTarget.z + this.dirOffset.z
    );
    this.dirLight.target.position.set(this.camTarget.x, 0, this.camTarget.z);
  }

  #addLights() {
    // Sky/ground hemisphere instead of a flat ambient, kept low so the key
    // light carries more of the exposure — surfaces get visible directional
    // shading (and readable shadows) instead of uniform brightness.
    this.scene.add(new THREE.HemisphereLight(0xfff5e0, 0xa89c85, 1.15));

    // Key light: strong, at a fairly low sun angle so ground bump/texture
    // detail catches raking light and shadows read.
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

    // Softer fill from the opposite side so the unlit side of objects never
    // goes dark — no shadows, this light is purely there to fill.
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
    const aspect = w / h;
    const half = settings.camera.viewSize / 2;
    // Portrait flag feeds follow()'s z-bias below; keep it in sync with the fit.
    this.isPortrait = aspect < 1;
    // "Contain" fit with a clamp at each aspect extreme (both frustum ratios
    // always equal the screen's, so the canvas is filled edge-to-edge with no
    // distortion and no black bars at ANY aspect):
    // • Landscape anchors the vertical span at viewSize; width grows with
    //   aspect UP TO maxAspectGrow — past it (ultrawide) the width freezes at
    //   viewSize × maxAspectGrow and the vertical span shrinks instead (a
    //   mild zoom-in), so a 21:9 screen stops turning the world into an island.
    // • Portrait anchors the horizontal span at viewSize; height grows with
    //   1/aspect UP TO portraitMaxStretch — past it (tall phones) the view
    //   zooms in (narrower than viewSize across) instead of stacking ever more
    //   empty grass above/below the 20-unit-deep room.
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
      // portraitZoom scales BOTH halves, so the aspect fit is preserved — the
      // whole portrait frame just moves in closer (see settings.camera).
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
