import * as THREE from 'three';
import settings from './config/settings.js';
import { createInitialState } from './core/GameState.js';
import { tick, tapRepair, hurry } from './core/simulation.js';
import { tickGasStation, tapFill, hurryPump } from './core/gasStation.js';
import { seedIdCounter } from './core/Car.js';
import {
  tickSupermarket,
  buyProduct,
  placeAtCheckout,
  restockShelf,
  hurryMarketWorker,
  takeRestockUnit,
} from './core/supermarket.js';
import { SceneManager } from './scene/SceneManager.js';
import { Input } from './scene/Input.js';
import { Character } from './scene/Character.js';
import { Cashier } from './scene/Cashier.js';
import { Garage } from './scene/Garage.js';
import { GroundField } from './scene/GroundField.js';
import { CarYard } from './scene/CarYard.js';
import { Hud } from './scene/Hud.js';
import { UpgradeMenu } from './scene/UpgradeMenu.js';
import {
  loadGame,
  saveGame,
  getSavedAt,
  setStorageBackend,
  PERSISTED_KEYS,
  reconcilePlatformReset,
} from './platform/storage.js';
import {
  initMusic,
  initAmbience,
  updateAmbience,
  setHammerActive,
  playMoneySound,
  playBagSound,
  suspendAll,
  resumeAll,
  setPlatformMuted,
  reloadAudioSettings,
} from './platform/audio.js';
import { configureAdPause } from './platform/ads.js';
import { initBridge, sendGameReady, isPlatformMuted, createBridgeStorageBackend } from '#bridge';
import { SettingsMenu } from './scene/SettingsMenu.js';
import { PauseControl } from './scene/PauseButton.js';
import { estimateOfflineEarnings } from './core/offlineEarnings.js';
import { ownedRightX } from './core/upgrades.js';
import { roomWallBox } from './core/collision.js';
import { rebuildGrid } from './core/pathfinding.js';
import { loadCharacterModel } from './scene/CharacterModel.js';
import { preloadCarModels } from './scene/CarView.js';
import { preloadMoneyModel, PitMoney } from './scene/PitMoney.js';
import { preloadStorageModels } from './scene/StorageModels.js';
import { preloadIcons } from './scene/icons.js';
import { CarriedBox } from './scene/CarriedBox.js';
import { SupermarketView } from './scene/SupermarketView.js';
import { GasStationView } from './scene/GasStationView.js';
import { BreakMenu } from './scene/BreakMenu.js';
import { BreakDisplays } from './scene/BreakDisplay.js';
import { TruckMenu } from './scene/TruckMenu.js';
import { UnlockMarkers } from './scene/UnlockMarkers.js';
import { SlidingDoors } from './scene/SlidingDoors.js';
import { Bridges } from './scene/Bridges.js';
import { Tunnels } from './scene/Tunnels.js';
import { PoofEffects, RevealPoofs } from './scene/Poof.js';
import { SparkleEffects } from './scene/Sparkle.js';
import {
  tickTutorial,
  notifyGarageTabViewed,
  notifyMarketShelfRestocked,
  notifyBreakMenuOpened,
} from './core/tutorial.js';
import { TutorialView } from './scene/TutorialView.js';

const container = document.getElementById('app');

if (!document.createElement('canvas').getContext('webgl2')) {
  const msg = document.createElement('div');
  Object.assign(msg.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '24px',
    background: '#12161c',
    color: '#e7ecf2',
    fontFamily: settings.ui.fontStack,
    textAlign: 'center',
    zIndex: '100',
  });
  const title = document.createElement('div');
  title.textContent = 'This device can’t run the game';
  Object.assign(title.style, { fontWeight: '800', fontSize: '22px' });
  const detail = document.createElement('div');
  detail.textContent = 'It needs WebGL2 graphics support. Please update your browser or try a newer device.';
  Object.assign(detail.style, { fontSize: '15px', color: '#9fb0c0', maxWidth: '420px' });
  msg.append(title, detail);
  document.body.appendChild(msg);
  throw new Error('WebGL2 unavailable — game not started');
}

if (document.fonts?.load) {
  document.fonts.load("900 34px 'Montserrat'").catch(() => {});
}

// The three pause sources OR into setPaused, so no source can cancel another's pause.
let paused = false;
let pauseControl = null; // constructed in main() once the game is playable
let userPaused = false;
let platformPaused = false;
let adPaused = false;
let gameStateReady = false; // `state` is created after the Bridge boot — early pauses must not save it

function applyPauseState() {
  setPaused(userPaused || platformPaused || adPaused);
}

function setPaused(v) {
  if (paused === v) return;
  paused = v;
  if (paused) {
    suspendAll();
    if (gameStateReady) saveGame(state);
  } else if (!document.hidden && !isPlatformMuted()) {
    resumeAll();
  }
  pauseControl?.sync(paused);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    suspendAll();
    if (gameStateReady) saveGame(state);
  } else if (!paused && !isPlatformMuted()) {
    resumeAll();
  }
});

// Bridge boot must finish BEFORE loadGame — on Bridge platforms the save lives in Bridge storage.
console.log('[boot] initializing platform bridge…');
const bridgeReady = await initBridge({
  onPauseChange: (isPaused) => {
    platformPaused = isPaused;
    applyPauseState();
  },
  onMuteChange: (m) => {
    setPlatformMuted(m);
    if (!m && !document.hidden && !paused) resumeAll();
  },
});
console.log(`[boot] bridge ${bridgeReady ? 'ready' : 'unavailable — running on local fallbacks'}`);
if (bridgeReady) {
  const bridgeBackend = await createBridgeStorageBackend(PERSISTED_KEYS);
  if (bridgeBackend) {
    setStorageBackend(bridgeBackend);
    reloadAudioSettings();
  }
  console.log(`[boot] storage backend: ${bridgeBackend ? 'bridge' : 'localStorage'}`);
  if (isPlatformMuted()) setPlatformMuted(true);
}
configureAdPause({
  pause: () => {
    adPaused = true;
    applyPauseState();
  },
  resume: () => {
    adPaused = false;
    applyPauseState();
  },
});

if (reconcilePlatformReset()) {
  console.warn('[boot] platform-side progress reset detected — starting fresh');
}

const loadedState = loadGame();
const state = loadedState ?? createInitialState();
gameStateReady = true; // setPaused / visibility saves may touch `state` from here on
const savedAt = loadedState ? getSavedAt() : null;
const offlineEarnings = savedAt ? estimateOfflineEarnings(state, Date.now() - savedAt) : 0;
seedIdCounter(state); // keep newly spawned ids past whatever the save already used
rebuildGrid([roomWallBox(ownedRightX(state))]);
const sceneManager = new SceneManager(container);
const input = new Input();
const hud = new Hud(state);
if (offlineEarnings > 0) hud.startOfflineDrain(offlineEarnings);
const menu = new UpgradeMenu(state);
new SettingsMenu(); // top-left Settings tab (music volume slider)
initMusic();
initAmbience();
new GroundField(sceneManager);
const garage = new Garage(sceneManager);
const breakDisplays = new BreakDisplays(sceneManager);
const bridges = new Bridges(sceneManager);
const tunnels = new Tunnels(sceneManager);
const poofs = new PoofEffects(sceneManager);
const revealPoofs = new RevealPoofs(poofs);
const sparkles = new SparkleEffects(sceneManager);

setInterval(() => saveGame(state), settings.persistence.autoSaveInterval * 1000);

main().catch((err) => console.error('[boot] fatal:', err));

async function main() {
  sceneManager.render();
  const loadingEl = showLoading();
  let gltf;
  try {
    gltf = await bootStep('character model', loadCharacterModel());
    await bootStep('car models', preloadCarModels());
    await bootStep('money model', preloadMoneyModel());
    await bootStep('storage models', preloadStorageModels());
    await bootStep('icons', preloadIcons());
  } catch (err) {
    loadingEl.textContent = 'Loading failed — please check your connection and reload';
    sendGameReady();
    console.error('[boot] asset preload failed — game not started:', err);
    return;
  }
  loadingEl.remove();
  sendGameReady();
  console.log('[boot] game ready');

  const character = new Character(gltf);
  sceneManager.add(character.root);

  const carYard = new CarYard(sceneManager, gltf, { poofs, sparkles });
  const pitMoney = new PitMoney(sceneManager);
  const carriedBox = new CarriedBox(sceneManager);
  const supermarketView = new SupermarketView(sceneManager, gltf);
  const gasStationView = new GasStationView(sceneManager, gltf);
  const pumpMoney = new PitMoney(sceneManager, settings.gasStation.positions, (s) => s.gasStation.pumps);
  const breakMenu = new BreakMenu(state); // opened by tapping a resting (on-break) worker
  const truckMenu = new TruckMenu(state); // opened by tapping an empty restock box
  const unlockMarkers = new UnlockMarkers(sceneManager);
  const slidingDoors = new SlidingDoors(sceneManager, () => supermarketView.truck.model);
  const tutorialView = new TutorialView(sceneManager, state, menu, unlockMarkers);
  pauseControl = new PauseControl((v) => {
    userPaused = v;
    applyPauseState();
  });
  let cashier = null; // spawned once state.hasCashier flips true (or already on load)

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  sceneManager.renderer.domElement.addEventListener('pointerdown', (e) => {
    if (paused) return; // belt and braces — the overlay already swallows canvas taps
    const rect = sceneManager.renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, sceneManager.camera);

    const restingPit = carYard.raycastRestingWorker(raycaster, state);
    if (restingPit >= 0) {
      e.stopPropagation(); // don't let Input's window listener also spawn a joystick here
      breakMenu.open(state.pits[restingPit].break, `Worker ${String.fromCharCode(65 + restingPit)}`);
      notifyBreakMenuOpened(state, restingPit); // tutorial: the first-break step wants this tap
      return;
    }
    if (supermarketView.raycastRestingWorker(raycaster, state)) {
      e.stopPropagation();
      breakMenu.open(state.supermarket.worker.break, 'Market Worker');
      return;
    }
    const restingPump = gasStationView.raycastRestingWorker(raycaster, state);
    if (restingPump >= 0) {
      e.stopPropagation();
      breakMenu.open(state.gasStation.pumps[restingPump].break, `Attendant ${restingPump + 1}`);
      return;
    }

    const marketHit = supermarketView.raycastTap(raycaster);
    if (marketHit) {
      e.stopPropagation();
      handleMarketTap(marketHit);
      return;
    }

    const i = carYard.raycast(raycaster);
    if (i >= 0) {
      e.stopPropagation(); // tapping a car/mechanic is an action, not a movement press
      const pit = state.pits[i];
      if (pit.hasMechanic && hurry(state, i)) {
        character.yell();
        character.showAngerBubble();
        carYard.pitViews[i].mechanic.alertBounce.trigger();
      } else if (pit.playerPresent && pit.car && !pit.car.fixed && (!pit.hasMechanic || pit.break.onBreak)) {
        tapRepair(state, i);
        character.repair();
        carYard.onTap(i);
      }
      return;
    }

    const mi = carYard.raycastMechanic(raycaster);
    if (mi >= 0) {
      e.stopPropagation();
      if (hurry(state, mi)) {
        character.yell();
        character.showAngerBubble();
        carYard.pitViews[mi].mechanic.alertBounce.trigger();
      }
      return;
    }

    const gi = gasStationView.raycast(raycaster);
    if (gi >= 0) {
      e.stopPropagation(); // tapping a pump car/attendant is an action, not a movement press
      const pump = state.gasStation.pumps[gi];

      if (pump.hasAttendant && hurryPump(state, gi)) {
        character.yell();
        character.showAngerBubble();
        gasStationView.pumpViews[gi].attendant.alertBounce.trigger();
      } else if (pump.playerPresent && pump.car && !pump.car.fixed) {
        tapFill(state, gi);
        character.pumpGas();
        gasStationView.onTap(gi);
      }
      return;
    }

    const ai = gasStationView.raycastAttendant(raycaster);
    if (ai >= 0) {
      e.stopPropagation();
      if (hurryPump(state, ai)) {
        character.yell();
        character.showAngerBubble();
        gasStationView.pumpViews[ai].attendant.alertBounce.trigger();
      }
    }
  });

  function handleMarketTap(hit) {
    const market = state.supermarket;
    const M = settings.supermarket;
    const near = (pos) =>
      Math.hypot(state.player.position.x - pos.x, state.player.position.z - pos.z) <= M.interactRadius;

    if (hit.kind === 'worker' && !market.worker.break.onBreak) {
      hurryMarketWorker(state);
      character.yell();
      character.showAngerBubble();
      supermarketView.worker.alertBounce.trigger();
    } else if (hit.kind === 'shelf') {
      const cfg = M.shelves[hit.index];
      if (!near(cfg)) return;
      if (state.player.carryingRestockBox) {
        if (market.workerLevel < 2 && restockShelf(state, hit.index)) {
          state.player.carryingRestockBox = false;
          notifyMarketShelfRestocked(state); // tutorial: a PLAYER restock (the worker never taps)
        }
      } else if (market.workerLevel === 0) {
        buyProduct(state, hit.index);
      }
    } else if (hit.kind === 'checkout') {
      if (market.workerLevel === 0 && near(M.checkoutPosition)) placeAtCheckout(state);
    } else if (hit.kind === 'restockBox') {
      if (market.restockBox.units <= 0) {
        truckMenu.open();
      } else if (
        market.workerLevel < 2 &&
        !state.player.carryingRestockBox &&
        !state.player.carryingBox && // hands full with a pit tire box — mirrors updateStorage's pickup gate
        near(market.restockBoxPosition)
      ) {
        if (takeRestockUnit(state)) state.player.carryingRestockBox = true;
      }
    }
  }

  const clock = new THREE.Clock();
  const basis = sceneManager.moveBasis; // camera-relative ground axes

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05); // clamp tab-switch jumps (getDelta each frame keeps the clock fresh across a pause)

    if (paused) {
      sceneManager.render();
      requestAnimationFrame(frame);
      return;
    }

    const ix = input.value.x;
    const iy = input.value.y;
    state.input.x = basis.right.x * ix + basis.forward.x * iy;
    state.input.z = basis.right.z * ix + basis.forward.z * iy;

    tick(state, dt); // movement + spawning + queue→pits + workers' auto-repair
    tickSupermarket(state, dt); // supermarket customers + (once hired) the market worker
    tickGasStation(state, dt); // gas pumps: spawning + queue→pumps + attendants' auto-fill
    if (menu.isOpen && menu.activeTab === 'garage') notifyGarageTabViewed(state);
    tickTutorial(state, dt);

    updateAmbience(ambienceZoneForX(state.player.position.x), dt);

    if (
      state.pits.some((pit) => pit.collectedThisTick > 0) ||
      state.gasStation.pumps.some((pump) => pump.collectedThisTick > 0)
    ) {
      playMoneySound();
    }
    if (state.supermarket.paidThisTick > 0) {
      playBagSound();
      playMoneySound();
    }

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

    for (const pump of state.gasStation.pumps) {
      if (!pump.equipped) {
        pump.playerPresent = false;
        continue;
      }
      const p = settings.gasStation.positions[pump.index];
      pump.playerPresent =
        Math.hypot(state.player.position.x - p.x, state.player.position.z - p.z) <= settings.gasStation.radius;
    }

    if (state.hasCashier && !cashier) {
      cashier = new Cashier(gltf, sceneManager);
      sceneManager.add(cashier.root);
    }
    if (cashier) cashier.update(dt);

    character.update(dt, state.player, state);
    carriedBox.update(state.player, state);
    garage.update(dt, state);
    bridges.update(state);
    tunnels.update(state);
    slidingDoors.update(dt, state);
    carYard.update(dt, state);
    setHammerActive(character.wrench.visible || carYard.pitViews.some((pv) => pv.mechanic?.wrench.visible));
    supermarketView.update(dt, state);
    gasStationView.update(dt, state);
    breakDisplays.update(state);
    pitMoney.update(dt, state, state.player.position);
    pumpMoney.update(dt, state, state.player.position);
    unlockMarkers.update(dt, state, state.player.position);
    revealPoofs.update(state); // fires poofs on this frame's reveal edges…
    poofs.update(dt); // …and animates the live bursts
    sparkles.update(dt); // repair-complete glitter bursts (fired from CarYard)
    breakMenu.update();
    truckMenu.update();
    hud.update(state.cash, dt);
    menu.update(state);
    tutorialView.update(dt, state);

    sceneManager.follow(state.player.position.x, state.player.position.z, dt);
    sceneManager.render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function ambienceZoneForX(x) {
  const W = settings.world;
  if (x < -W.halfX) return 'gasStation';
  if (x < settings.supermarket.lobbyRightX) return 'market';
  return 'garage';
}

async function bootStep(name, promise) {
  console.log(`[boot] loading ${name}…`);
  try {
    const result = await promise;
    console.log(`[boot] ${name} loaded`);
    return result;
  } catch (err) {
    console.error(`[boot] ${name} failed:`, err);
    throw err;
  }
}

function showLoading() {
  const el = document.createElement('div');
  el.textContent = 'Loading…';
  Object.assign(el.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    font: `800 22px ${settings.ui.fontStack}`,
    color: '#e7ecf2',
    textShadow: '0 2px 0 rgba(0,0,0,0.6)',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '30',
  });
  document.body.appendChild(el);
  return el;
}
