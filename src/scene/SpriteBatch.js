import * as THREE from 'three';

// SpriteBatch — fixed-capacity instanced billboard quads: ONE draw call for all
// live particles. Exists because per-THREE.Sprite draw calls stuttered on mobile.
// Contract: write slots 0..n-1 via set() each frame, then commit(n).
export class SpriteBatch {
  constructor(sceneManager, { texture, capacity, blending = THREE.NormalBlending, renderOrder = 0 }) {
    this.capacity = capacity;

    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    geometry.setAttribute('uv', plane.attributes.uv);
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aScale = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const attr of [this.aOffset, this.aScale, this.aTint]) attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aOffset', this.aOffset);
    geometry.setAttribute('aScale', this.aScale);
    geometry.setAttribute('aTint', this.aTint);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute float aScale;
        attribute vec4 aTint;
        varying vec2 vUv;
        varying vec4 vTint;
        void main() {
          vUv = uv;
          vTint = aTint;
          // Billboard: place the instance origin in view space, then push the
          // quad corners out in view-space XY — always camera-facing.
          vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
          mv.xy += position.xy * aScale;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec4 vTint;
        void main() {
          gl_FragColor = texture2D(map, vUv) * vTint;
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    sceneManager.add(this.mesh);
  }

  set(i, x, y, z, scale, r, g, b, a) {
    const o3 = i * 3;
    const o4 = i * 4;
    this.aOffset.array[o3] = x;
    this.aOffset.array[o3 + 1] = y;
    this.aOffset.array[o3 + 2] = z;
    this.aScale.array[i] = scale;
    this.aTint.array[o4] = r;
    this.aTint.array[o4 + 1] = g;
    this.aTint.array[o4 + 2] = b;
    this.aTint.array[o4 + 3] = a;
  }

  commit(count) {
    this.geometry.instanceCount = count;
    if (count === 0) return;
    this.aOffset.needsUpdate = true;
    this.aScale.needsUpdate = true;
    this.aTint.needsUpdate = true;
  }
}
