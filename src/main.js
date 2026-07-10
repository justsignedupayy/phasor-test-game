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
import { loadGame, saveGame, getSavedAt } from './platform/storage.js';
import {
  initMusic,
  initAmbience,
  updateAmbience,
  setHammerActive,
  playMoneySound,
  playBagSound,
  suspendAll,
  resumeAll,
} from './platform/audio.js';
import { SettingsMenu } from './scene/SettingsMenu.js';
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

// WebGL2 gate: Three.js r163+ is WebGL2-only, and on a device without it the
// WebGLRenderer constructor throws — leaving a silent black page. Probe BEFORE
// booting anything and show a friendly message instead; the throw halts the
// rest of this module so no renderer/game construction is ever attempted.
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

// Warm the UI font (settings.ui.fontStack / @font-face in style.css) so canvas
// text sprites — customer requests, pit labels, cash popups — draw in it from
// the first frame instead of the system fallback. Fire-and-forget: canvas draws
// don't trigger a font load on their own the way DOM text does.
if (document.fonts?.load) {
  document.fonts.load("900 34px 'Montserrat'").catch(() => {});
}

// Core state (Three-free) and render layer. Resume a save if one exists; if it
// is one (not a fresh state) and carries a savedAt, estimate what was earned
// while away — handed to the Hud below once it exists (Hud owns draining it in).
const loadedState = loadGame();
const state = loadedState ?? createInitialState();
const savedAt = loadedState ? getSavedAt() : null;
const offlineEarnings = savedAt ? estimateOfflineEarnings(state, Date.now() - savedAt) : 0;
seedIdCounter(state); // keep newly spawned ids past whatever the save already used
// The A* grid is built at module load WITHOUT the room's moving fence wall (it's
// state-dependent); fold it in for the starting/loaded ownedRightX, exactly as
// buyExpandRoom does after every later purchase — otherwise the grid only learns
// about the fence on the next Expand Room buy.
rebuildGrid([roomWallBox(ownedRightX(state))]);
const sceneManager = new SceneManager(container);
const input = new Input();
const hud = new Hud(state);
if (offlineEarnings > 0) hud.startOfflineDrain(offlineEarnings);
const menu = new UpgradeMenu(state);
new SettingsMenu(); // top-left Settings tab (music volume slider)
// Looping background music at the persisted volume; if autoplay is blocked it
// starts on the first user gesture instead (see platform/audio.js).
initMusic();
// The three area-ambience layers, silent until the per-frame zone check below
// fades one in.
initAmbience();
// Minimizing the tab throttles requestAnimationFrame (freezing the game) but
// HTMLAudioElements would keep sounding — silence every looping track while
// hidden and resume them on return (also save right away, since the throttled
// autosave interval may never fire again if the tab is killed).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    suspendAll();
    saveGame(state);
  } else {
    resumeAll();
  }
});

new GroundField(sceneManager);
const garage = new Garage(sceneManager);
// Wall-mounted LED panels over every worker's break-lean spot (jobs-to-break /
// break countdown), driven purely from core break state each frame.
const breakDisplays = new BreakDisplays(sceneManager);
const bridges = new Bridges(sceneManager);
// Static tunnel-mouth props at the market's customer entry + exit (customers
// emerge from / vanish into them rather than popping in/out); shown with the market.
const tunnels = new Tunnels(sceneManager);
// Cartoon poof-cloud bursts wherever something new reveals (see scene/Poof.js);
// RevealPoofs watches the state flags the views already gate visibility on.
const poofs = new PoofEffects(sceneManager);
const revealPoofs = new RevealPoofs(poofs);
// Bright glitter burst; fired alongside a poof when a car finishes repair at a
// pit (garage-only — see scene/CarYard.js).
const sparkles = new SparkleEffects(sceneManager);

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
  await preloadIcons();
  loadingEl.remove();

  const character = new Character(gltf);
  sceneManager.add(character.root);

  const carYard = new CarYard(sceneManager, gltf, { poofs, sparkles });
  const pitMoney = new PitMoney(sceneManager);
  const carriedBox = new CarriedBox(sceneManager);
  const supermarketView = new SupermarketView(sceneManager, gltf);
  const gasStationView = new GasStationView(sceneManager, gltf);
  // Pump pay uses the same waiting-bills view as pit pay, pointed at the pumps.
  const pumpMoney = new PitMoney(sceneManager, settings.gasStation.positions, (s) => s.gasStation.pumps);
  const breakMenu = new BreakMenu(state); // opened by tapping a resting (on-break) worker
  const truckMenu = new TruckMenu(state); // opened by tapping an empty restock box
  // World-space create/hire purchases: ground circles that auto-buy on
  // proximity (step-1 physical unlocks; see core/upgrades.getUnlockMarkers).
  const unlockMarkers = new UnlockMarkers(sceneManager);
  // Automatic sliding glass doors on the walk-in entrances (gas gate, customer
  // entry/exit, delivery gate); the delivery door also tracks the truck's tween.
  const slidingDoors = new SlidingDoors(sceneManager, () => supermarketView.truck.model);
  // The first-game tutorial overlay: glow ring / UI glow + instruction bubble,
  // driven by core/tutorial.js's view model (resolves tablet targets via `menu`).
  const tutorialView = new TutorialView(sceneManager, state, menu, unlockMarkers);
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

    // A resting (on-break) worker opens the break panel (works from anywhere,
    // like a remote hurry tap). Checked before the worker/car raycasts so the
    // resting worker wins.
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
      } else if (pit.playerPresent && pit.car && !pit.car.fixed) {
        tapRepair(state, i);
        character.repair();
        carYard.onTap(i);
      }
      return;
    }

    // Tapping a working mechanic's own body (not its car) is the same "yell"
    // gesture — the mechanic can stand away from or block the car, and yelling
    // AT the worker is the intuitive tap target either way.
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

    // Pump cars mirror pit cars: a manned pump's car = remote hurry (from
    // anywhere); an unmanned equipped pump's car = manual fill while standing there.
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

    // Tapping a working attendant's own body (not its car) — mirrors the
    // pit-mechanic tap above.
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
      // Empty box: a tap (from anywhere) opens the "waiting for truck" panel with
      // the Call-Truck-Early ad button, instead of any pickup.
      if (market.restockBox.units <= 0) {
        truckMenu.open();
      } else if (
        market.workerLevel < 2 &&
        !state.player.carryingRestockBox &&
        !state.player.carryingBox && // hands full with a pit tire box — mirrors updateStorage's pickup gate
        near(market.restockBoxPosition)
      ) {
        // Pick up one unit (decrements the box) to carry to a shelf.
        if (takeRestockUnit(state)) state.player.carryingRestockBox = true;
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
    tickGasStation(state, dt); // gas pumps: spawning + queue→pumps + attendants' auto-fill
    // Tutorial: the "opened the Garage tab" step completes by simply seeing the
    // tab (checked per-frame while open); then advance the state-watched steps.
    // Runs after the sims so one-tick signals (paidThisTick) are still readable.
    if (menu.isOpen && menu.activeTab === 'garage') notifyGarageTabViewed(state);
    tickTutorial(state, dt);

    // Area ambience: purely a function of this frame's player position.
    updateAmbience(ambienceZoneForX(state.player.position.x), dt);

    // Money one-shot: fires only on the discrete tick a pit/pump actually banks
    // its waiting pay (collectedThisTick is a one-tick render signal, zeroed at
    // the top of tick()/tickGasStation() — never on the marker drain's per-frame
    // trickle, which has its own moneysound call at UnlockMarkers' #finalize).
    if (
      state.pits.some((pit) => pit.collectedThisTick > 0) ||
      state.gasStation.pumps.some((pump) => pump.collectedThisTick > 0)
    ) {
      playMoneySound();
    }
    // Plastic-bag + money one-shots together: fires on the tick a customer's
    // checkout completes (state.supermarket.paidThisTick is the same kind of
    // one-tick signal as pit/pump collectedThisTick above).
    if (state.supermarket.paidThisTick > 0) {
      playBagSound();
      playMoneySound();
    }

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

    // Same per-frame proximity flags for the gas pumps (fill taps + pay collection).
    for (const pump of state.gasStation.pumps) {
      if (!pump.equipped) {
        pump.playerPresent = false;
        continue;
      }
      const p = settings.gasStation.positions[pump.index];
      pump.playerPresent =
        Math.hypot(state.player.position.x - p.x, state.player.position.z - p.z) <= settings.gasStation.radius;
    }

    // Cashier NPC: appears at the desk the moment one is hired, then idles forever.
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
    // Hammer loop: on while the player or any pit mechanic is in its 'repair'
    // clip — the same condition already driving the wrench prop's visibility.
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

/**
 * Which area-ambience zone a player x falls in — mirrors the world's actual
 * layout: the gas station is entirely OUTSIDE the building (x < -halfX, see
 * settings.gasStation), the market/lobby is the building's left slice up to
 * the lobby/bay seam (settings.supermarket.lobbyRightX, shared with the lobby
 * floor patch in scene/Garage.js), and everything right of that is the pit bay.
 */
function ambienceZoneForX(x) {
  const W = settings.world;
  if (x < -W.halfX) return 'gasStation';
  if (x < settings.supermarket.lobbyRightX) return 'market';
  return 'garage';
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
