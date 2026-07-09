import * as THREE from 'three';
import settings from '../config/settings.js';
import { makeGrassMaterial } from './groundTextures.js';

/**
 * GroundField — one large, static, low-poly grass plane under the entire world,
 * so the isometric camera never sees the flat background colour past the roads.
 *
 * Sized from settings.world (halfX/halfZ + road.extent + grass.buffer) so it
 * comfortably outruns the exterior roads, the gas station's pump row on the far
 * left AND the camera's follow-lerp. Subdivided into grass.segments² quads with
 * a small random saturation/lightness offset per vertex around colors.grass,
 * so it reads as mottled/natural instead of a flat green sheet. It sits just
 * below y=0 — under the garage floor (y=0) and every road slab (y=0.006) — so
 * nothing z-fights. Built once at setup; never touched at runtime.
 */
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

    // Tileable procedural grass map + bump over the vertex-colour facets, so
    // the field reads as textured ground up close, not one smooth green sheet.
    const field = new THREE.Mesh(geo, makeGrassMaterial(halfW * 2, halfD * 2));
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.02;
    field.receiveShadow = true;
    sceneManager.add(field);
  }
}
