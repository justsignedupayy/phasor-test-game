import * as THREE from 'three';
import settings from '../config/settings.js';

/**
 * createGarage — the static environment: floor, subtle grid, the queue lane, the
 * repair-pit patch, and low walls with door gaps on the left/right (entrance and
 * exit) marked by pillars + lintels. Cars (queue + pit) are dynamic and owned by
 * CarYard, not built here.
 */
export function createGarage() {
  const group = new THREE.Group();
  const c = settings.colors;
  const W = settings.world;

  const floorW = W.halfX * 2;
  const floorD = W.halfZ * 2;
  const h = W.wallHeight;
  const t = W.wallThickness;
  const gz = settings.pit.z; // gates are centred on the lane
  const g = W.gateHalf;

  // Floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorW, floorD),
    new THREE.MeshStandardMaterial({ color: c.floor })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Subtle grid (1-unit cells).
  const grid = new THREE.GridHelper(Math.max(floorW, floorD), Math.max(floorW, floorD), c.grid, c.grid);
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  group.add(grid);

  // Queue lane strip, from the pit out to the entrance gate.
  const laneX0 = settings.pit.x;
  const laneX1 = W.halfX;
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(laneX1 - laneX0 + 1, 2.4),
    new THREE.MeshStandardMaterial({ color: c.lane })
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.set((laneX0 + laneX1) / 2, 0.012, gz);
  lane.receiveShadow = true;
  group.add(lane);

  // Repair-pit patch (floor marker). The car on it is added by CarYard.
  const pit = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 4),
    new THREE.MeshStandardMaterial({ color: c.pit })
  );
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(settings.pit.x, 0.02, gz);
  pit.receiveShadow = true;
  group.add(pit);

  // Walls.
  const wallMat = new THREE.MeshStandardMaterial({ color: c.wall, flatShading: true });
  const wall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };

  // Front/back walls (solid, run along x).
  wall(floorW + t, t, 0, -W.halfZ - t / 2);
  wall(floorW + t, t, 0, W.halfZ + t / 2);

  // Left/right walls (run along z) split around the gate gap at z = gz.
  const segALen = gz - g - -W.halfZ; // lower segment length
  const segACenter = (-W.halfZ + (gz - g)) / 2;
  const segBLen = W.halfZ - (gz + g); // upper segment length
  const segBCenter = (gz + g + W.halfZ) / 2;
  for (const sx of [-W.halfX - t / 2, W.halfX + t / 2]) {
    wall(t, segALen, sx, segACenter);
    wall(t, segBLen, sx, segBCenter);
  }

  // Gate pillars + lintels at both doorways (entrance on +x, exit on -x).
  const gateMat = new THREE.MeshStandardMaterial({ color: c.gate, flatShading: true });
  const pillar = (x, z) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, h * 1.6, 0.6), gateMat);
    p.position.set(x, h * 0.8, z);
    p.castShadow = true;
    group.add(p);
  };
  const lintel = (x) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, g * 2 + 0.6), gateMat);
    l.position.set(x, h * 1.6, gz);
    l.castShadow = true;
    group.add(l);
  };
  for (const sx of [-W.halfX, W.halfX]) {
    pillar(sx, gz - g);
    pillar(sx, gz + g);
    lintel(sx);
  }

  return group;
}
