import * as THREE from 'three';
import settings from './config/settings.js';
import { createInitialState } from './core/GameState.js';
import { tick, tapRepair, hurry } from './core/simulation.js';
import { seedIdCounter } from './core/Car.js';
import { tickSupermarket, buyProduct, placeAtCheckout, restockShelf, hurryMarketWorker } from './core/supermarket.js';
import { SceneManager } from './scene/SceneManager.js';
import { Input } from './scene/Input.js';
import { Character } from './scene/Character.js';
import { Cashier } from './scene/Cashier.js';
import { Garage } from './scene/Garage.js';
import { CarYard } from './scene/CarYard.js';
import { Hud } from './scene/Hud.js';
import { UpgradeMenu } from './scene/UpgradeMenu.js';
import { Computer } from './scene/Computer.js';
import { AdvertisingMenu } from './scene/AdvertisingMenu.js';
import { loadGame, saveGame } from './platform/storage.js';
import { loadCharacterModel } from './scene/CharacterModel.js';
import { preloadCarModels } from './scene/CarView.js';
import { preloadMoneyModel, PitMoney } from './scene/PitMoney.js';
import { preloadStorageModels } from './scene/StorageModels.js';
import { CarriedBox } from './scene/CarriedBox.js';
import { SupermarketView } from './scene/SupermarketView.js';

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
  await preloadCarModels();
  await preloadMoneyModel();
  await preloadStorageModels();
  loadingEl.remove();

  const character = new Character(gltf);
  sceneManager.add(character.root);

  const carYard = new CarYard(sceneManager, gltf);
  const pitMoney = new PitMoney(sceneManager);
  const carriedBox = new CarriedBox(sceneManager);
  const supermarketView = new SupermarketView(sceneManager, gltf);
  let cashier = null; // spawned once state.hasCashier flips true (or already on load)

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

    const marketHit = supermarketView.raycastTap(raycaster);
    if (marketHit) {
      handleMarketTap(marketHit);
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

  /**
   * Manual market taps — only meaningful at workerLevel 0 (packaging/checkout)
   * or workerLevel < 2 (restocking; the player still restocks at level 1).
   * Proximity is checked here at tap-time, the same role state.pits[i].playerPresent
   * plays for tapRepair, just computed inline instead of written every frame.
   * Tapping the worker itself is the one exception: a remote hurry, same as
   * tapping a manned pit's car, so it works from anywhere with no proximity check.
   */
  function handleMarketTap(hit) {
    const market = state.supermarket;
    const M = settings.supermarket;
    const near = (pos) =>
      Math.hypot(state.player.position.x - pos.x, state.player.position.z - pos.z) <= M.interactRadius;

    if (hit.kind === 'worker') {
      hurryMarketWorker(state);
      character.yell();
    } else if (hit.kind === 'shelf') {
      const cfg = M.shelves[hit.index];
      if (!near(cfg)) return;
      if (state.player.carryingRestockBox) {
        if (market.workerLevel < 2 && restockShelf(state, hit.index)) state.player.carryingRestockBox = false;
      } else if (market.workerLevel === 0) {
        buyProduct(state, hit.index);
      }
    } else if (hit.kind === 'checkout') {
      if (market.workerLevel === 0 && near(M.checkoutPosition)) placeAtCheckout(state);
    } else if (hit.kind === 'restockBox') {
      if (market.workerLevel < 2 && !state.player.carryingRestockBox && near(market.restockBoxPosition)) {
        state.player.carryingRestockBox = true;
      }
    }
  }

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
    tickSupermarket(state, dt); // supermarket customers + (once hired) the market worker

    // Scene sets per-pit proximity each frame; core only reads these flags.
    // playerPresent = near the worker/pit (repair + box delivery); playerNearShelf
    // = near this pit's shelf (box pickup).
    for (const pit of state.pits) {
      if (!pit.equipped) {
        pit.playerPresent = false;
        pit.playerNearShelf = false;
        continue;
      }
      const p = settings.pit.positions[pit.index];
      const px = state.player.position.x;
      const pz = state.player.position.z;
      pit.playerPresent = Math.hypot(px - p.x, pz - p.z) <= settings.pit.radius;
      const so = settings.storage.shelfOffset;
      pit.playerNearShelf = Math.hypot(px - (p.x + so.x), pz - (p.z + so.z)) <= settings.storage.pickupRadius;
    }

    // Cashier NPC: appears at the desk the moment one is hired, then idles forever.
    if (state.hasCashier && !cashier) {
      cashier = new Cashier(gltf);
      sceneManager.add(cashier.root);
    }
    if (cashier) cashier.update(dt);

    character.update(dt, state.player);
    carriedBox.update(state.player);
    garage.update(dt, state);
    carYard.update(dt, state);
    computer.update(dt, state);
    supermarketView.update(dt, state);
    pitMoney.update(dt, state, state.player.position);
    adMenu.update();
    hud.update(state.cash, state.repBoostRemaining);
    menu.update(state);

    sceneManager.follow(state.player.position.x, state.player.position.z, dt);
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
