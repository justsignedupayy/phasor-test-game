import * as THREE from 'three';
import settings from './config/settings.js';
import { createInitialState } from './core/GameState.js';
import { tick, tapRepair, hurry } from './core/simulation.js';
import { seedIdCounter } from './core/Car.js';
import { SceneManager } from './scene/SceneManager.js';
import { Input } from './scene/Input.js';
import { Character } from './scene/Character.js';
import { Garage } from './scene/Garage.js';
import { CarYard } from './scene/CarYard.js';
import { Hud } from './scene/Hud.js';
import { UpgradeMenu } from './scene/UpgradeMenu.js';
import { Computer } from './scene/Computer.js';
import { AdvertisingMenu } from './scene/AdvertisingMenu.js';
import { loadGame, saveGame } from './platform/storage.js';
import { loadCharacterModel } from './scene/CharacterModel.js';

const container = document.getElementById('app');

// Core state (Three-free) and render layer. Resume a save if one exists (no
// offline-earnings catch-up — it's restored exactly as it was last saved).
const state = loadGame() ?? createInitialState();
seedIdCounter(state); // keep newly spawned ids past whatever the save already used
const sceneManager = new SceneManager(container);
const input = new Input();
const hud = new Hud();
const menu = new UpgradeMenu(state);

const garage = new Garage(sceneManager);
const computer = new Computer(sceneManager);
const adMenu = new AdvertisingMenu(state);

setInterval(() => saveGame(state), settings.persistence.autoSaveInterval * 1000);

main();

async function main() {
  // The garage itself doesn't need the character model, so render it once
  // right away — the loading overlay then sits over a non-blank scene while
  // the rigged glTF (shared by the player + every worker) loads exactly once.
  sceneManager.render();
  const loadingEl = showLoading();
  const gltf = await loadCharacterModel();
  loadingEl.remove();

  const character = new Character(gltf);
  sceneManager.add(character.root);

  const carYard = new CarYard(sceneManager, gltf);

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

    if (computer.raycastTap(raycaster)) {
      adMenu.open();
      return;
    }

    const i = carYard.raycast(raycaster);
    if (i < 0) return;
    const pit = state.pits[i];

    if (pit.hasMechanic) {
      hurry(state, i);
      character.yell();
    } else if (pit.playerPresent && pit.car && !pit.car.fixed) {
      tapRepair(state, i);
      character.repair();
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
    garage.update(dt, state);
    carYard.update(dt, state);
    computer.update(dt, state);
    adMenu.update();
    hud.update(state.cash, state.repBoostRemaining);
    menu.update(state);

    sceneManager.render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function showLoading() {
  const el = document.createElement('div');
  el.textContent = 'Loading…';
  Object.assign(el.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    font: '800 22px Arial, sans-serif',
    color: '#e7ecf2',
    textShadow: '0 2px 0 rgba(0,0,0,0.6)',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '30',
  });
  document.body.appendChild(el);
  return el;
}
