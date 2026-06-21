import * as THREE from 'three';
import settings from './config/settings.js';
import { createInitialState } from './core/GameState.js';
import { tick, tapRepair, hurry } from './core/simulation.js';
import { SceneManager } from './scene/SceneManager.js';
import { Input } from './scene/Input.js';
import { Character } from './scene/Character.js';
import { createGarage } from './scene/Garage.js';
import { CarYard } from './scene/CarYard.js';
import { Hud } from './scene/Hud.js';
import { UpgradeMenu } from './scene/UpgradeMenu.js';

const container = document.getElementById('app');

// Core state (Three-free) and render layer.
const state = createInitialState();
const sceneManager = new SceneManager(container);
const input = new Input();
const hud = new Hud();
const menu = new UpgradeMenu(state);

sceneManager.add(createGarage());

const character = new Character();
sceneManager.add(character.root);

const carYard = new CarYard(sceneManager);

// Canvas taps only (the joystick and DOM menu are separate overlays, so their
// taps never reach here). A tap raycasts the pit cars and applies to the touched
// car's pit: a manned pit's car = remote hurry (from anywhere); an unmanned
// equipped pit's car = manual repair, but only while the player stands there.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
sceneManager.renderer.domElement.addEventListener('pointerdown', (e) => {
  const rect = sceneManager.renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, sceneManager.camera);

  const i = carYard.raycast(raycaster);
  if (i < 0) return;
  const pit = state.pits[i];

  if (pit.hasMechanic) {
    hurry(state, i);
    character.yell();
  } else if (pit.playerPresent && pit.car && !pit.car.fixed) {
    tapRepair(state, i);
    carYard.onTap(i);
  }
});

const clock = new THREE.Clock();
const basis = sceneManager.moveBasis; // camera-relative ground axes

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); // clamp tab-switch jumps

  // Screen-space joystick -> camera-relative world direction -> core.
  const ix = input.value.x;
  const iy = input.value.y;
  state.input.x = basis.right.x * ix + basis.forward.x * iy;
  state.input.z = basis.right.z * ix + basis.forward.z * iy;

  tick(state, dt); // movement + spawning + queue→pits + workers' auto-repair

  // Scene sets per-pit proximity each frame; core only reads playerPresent.
  for (const pit of state.pits) {
    if (!pit.equipped) {
      pit.playerPresent = false;
      continue;
    }
    const p = settings.pit.positions[pit.index];
    const dx = state.player.position.x - p.x;
    const dz = state.player.position.z - p.z;
    pit.playerPresent = Math.hypot(dx, dz) <= settings.pit.radius;
  }

  character.update(dt, state.player);
  carYard.update(dt, state);
  hud.update(state.cash);
  menu.update(state);

  sceneManager.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
