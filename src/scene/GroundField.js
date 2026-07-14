import * as THREE from 'three';
import settings from '../config/settings.js';
import { makeGrassMaterial } from './groundTextures.js';

export class GroundField {
  constructor(sceneManager) {
    const W = settings.world;
    const G = W.grass;
    const halfW = W.halfX + W.road.extent + G.buffer;
    const halfD = W.halfZ + W.road.extent + G.buffer;

    const geo = new THREE.PlaneGeometry(halfW * 2, halfD * 2, G.segments, G.segments);
    const base = new THREE.Color(settings.colors.grass);
    const shade = new THREE.Color();
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      shade
        .copy(base)
        .offsetHSL(0, (Math.random() - 0.5) * G.colorJitter, (Math.random() - 0.5) * G.colorJitter);
      colors[i * 3] = shade.r;
      colors[i * 3 + 1] = shade.g;
      colors[i * 3 + 2] = shade.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const field = new THREE.Mesh(geo, makeGrassMaterial(halfW * 2, halfD * 2));
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.02;
    field.receiveShadow = true;
    sceneManager.add(field);
  }
}
