import * as THREE from 'three';
import settings from './config/settings.js';
import { createInitialState } from './core/GameState.js';
import { tick, tapRepair, hurry } from './core/simulation.js';
import { SceneManager } from './scene/SceneManager.js';
import { Input } from './scene/Input.js';
import { Character } from './scene/Character.js';
import { createGarage } from './scene/Garage.js';
import { CarYard } from './scene/CarYard.js';
import { Mechanic } from './scene/Mechanic.js';
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

let mechanic = null; // spawned when the player hires one

// Canvas taps only (the joystick and the DOM menu are separate overlays, so their
// taps never reach here). With a mechanic, any such tap is a remote "hurry";
// before hiring, it's the in-pit manual repair.
sceneManager.renderer.domElement.addEventListener('pointerdown', () => {
  if (state.upgrades.hasMechanic) {
    hurry(state);
    character.yell();
  } else if (state.pit.playerPresent && state.pit.car && !state.pit.car.fixed) {
    tapRepair(state);
    carYard.onTap();
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

  tick(state, dt); // movement + spawning + queue→pit + mechanic auto-repair

  // Scene sets proximity each frame; core only reads playerPresent.
  const dx = state.player.position.x - settings.pit.x;
  const dz = state.player.position.z - settings.pit.z;
  state.pit.playerPresent = Math.hypot(dx, dz) <= settings.pit.radius;

  // Spawn the mechanic NPC the moment one is hired.
  if (state.upgrades.hasMechanic && !mechanic) {
    mechanic = new Mechanic();
    sceneManager.add(mechanic.root);
  }

  character.update(dt, state.player);
  carYard.update(dt, state);
  if (mechanic) {
    mechanic.update(dt, { carPresent: !!state.pit.car, hurrying: state.hurryTimer > 0 });
  }
  hud.update(state.cash);
  menu.update(state);

  sceneManager.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
