/**
 * settings.js — every tunable value lives here (no Three.js imports).
 * Colors are plain hex ints so this file stays framework-agnostic.
 */
export const settings = {
  // How many parallel pits can ever exist. Pit 0 starts unlocked + equipped.
  maxPits: 5,

  // Garage interior bounds (character is clamped inside these on the x/z plane).
  // halfX is wide enough for the left lobby (clear of all pits) plus the five-pit
  // row to its right.
  world: {
    halfX: 15,
    halfZ: 10,
    wallHeight: 1.6,
    wallThickness: 0.4,
    gateHalf: 1.8, // half-width of the door gaps in the left/right walls
  },

  player: {
    speed: 6, // world units / second
    radius: 0.6, // used for bounds clamping
    turnLerp: 12, // higher = snappier turning
  },

  camera: {
    viewSize: 30, // world units visible vertically (smaller = more zoomed in)
    distance: 40, // ortho position scale; does NOT change apparent size
    near: 0.1,
    far: 200,
    followLerp: 5, // how fast the camera eases toward the player each second (higher = snappier)
  },

  // The rigged glTF character (player + every worker clone it). modelScale and
  // modelYRotationOffset correct for a glb that imports at the wrong size/facing
  // — tune both once the model is visible in-scene. animationMap maps the
  // logical states driven from existing flags (moving/repairing/yell) to the
  // model's actual clip names — characterAnim.js's buildActionMap falls back
  // to the model's first clip (with a console.warn) for any name that doesn't
  // match, so a wrong guess here never freezes the character.
  //
  // CURRENT MODEL: CharacterModel.js merges character_idle.glb +
  // character_run.glb + character_repair.glb + character_yell.glb and renames
  // their clips to 'idle' / 'walk' / 'repair' / 'yell'.
  character: {
    modelScale: 1,
    modelYRotationOffset: 0, // radians, added on top of the movement-facing rotation
    animationMap: {
      idle: 'idle',
      walk: 'walk',
      repair: 'repair',
      yell: 'yell',
    },
    crossfadeDuration: 0.25, // seconds, used for every state transition
    workerTint: 0xe07b39, // multiplies worker clone materials so they read as "the mechanic" (was mechBody)
    cashierTint: 0x3ad06a, // green tint for the cashier clone (see scene/Cashier.js)
  },

  // Shared transform applied to every car glb when cloned (see CarView.js).
  // modelScale and modelYRotationOffset correct for glbs that import at the
  // wrong size/facing — tune once the models are visible in-scene.
  car: {
    modelScale: 1, // the per-tier glbs already bake their own ~0.01 scale; don't re-scale
    modelYRotationOffset: Math.PI, // ≈1.56 rad — cars now drive -z (door→pit); flip ±π if reversed
  },

  // The five reputation tiers, ascending (index 0 = worst, index 4 = best).
  // Higher reputation attracts higher-index cars (see Car.js spawnCar's weighted
  // roll). Each tier scales a car's repair time and payout, and has its own glb
  // model (in public/models/, preloaded + cloned per car by CarView.js).
  // baseTicks = ticksPerPart × parts × ticksMult; payout =
  // basePayoutPerPart × parts × payoutMult. STARTING VALUES — tune later.
  carTiers: [
    { name: 'rusty', ticksMult: 0.7, payoutMult: 0.6, model: 'normalcar.glb' },
    { name: 'normal', ticksMult: 1.0, payoutMult: 1.0, model: 'taxi.glb' },
    { name: 'decent', ticksMult: 1.3, payoutMult: 1.8, model: 'SUV.glb' },
    { name: 'premium', ticksMult: 1.7, payoutMult: 2.8, model: 'sports.glb' },
    { name: 'luxury', ticksMult: 2.2, payoutMult: 4.5, model: 'cop.glb' },
  ],

  joystick: {
    radius: 70, // px
    deadzone: 0.12,
  },

  // Repair is measured in ticks. A car needs baseTicks = ticksPerPart × numParts,
  // so a standard 3-damage car ≈ 15 ticks. A pit's required ticks shrink with its
  // fixing-time upgrade (car.baseTicks × pit.fixTimeFactor).
  repair: {
    ticksPerPart: 5, // 3-damage car → 15 ticks
    tapTicks: 1, // ticks added per manual repair tap (≈ a worker's base rate)
  },

  // Automatic spawning. Each pit owns its own waiting queue (no shared lane);
  // a spawned car is routed to the equipped pit with the shortest queue.
  spawn: {
    interval: 0.1, // seconds between spawns
    maxQueuePerPit: 10, // max cars waiting per pit's own queue
    basePayoutPerPart: 5, // payout = basePayoutPerPart × numParts (3-damage car = $15)
  },

  // Two-stage room unlock + the per-pit upgrades. All costs are geometric
  // (cost = baseCost × costGrowth^level); see upgrades.js for the level used.
  upgrades: {
    // TESTING: all baseCosts slashed to $1 for cheap iteration (costGrowth left
    // intact so cost still climbs per level — flattening both broke the
    // geometric-growth invariant via Math.round). Restore the commented
    // baseCost values below before shipping.
    // Stage 1: add empty floor space (reveals the next lot).
    expandRoom: {
      baseCost: 1, // was 300
      costGrowth: 1.6,
    },
    // Stage 2: install the repair station on a roomUnlocked lot. Scales by pit index.
    pitEquipment: {
      baseCost: 1, // was 150
      costGrowth: 1.6,
    },
    // One-time worker hire per pit (enables auto-repair + remote hurry). Scales by index.
    mechanic: {
      baseCost: 1, // was 60
      costGrowth: 1.5,
    },
    // Per-pit worker speed (ticks/sec).
    workerSpeed: {
      baseCost: 1, // was 50
      costGrowth: 1.6,
      maxLevel: 8,
      baseRate: 1, // ticks/sec at level 0 → a 15-tick car takes ~15s
      ratePerLevel: 0.5, // +ticks/sec per level
    },
    // Per-pit fixing time: lowers the fix-time factor (≤1), shrinking required ticks.
    fixingTime: {
      baseCost: 1, // was 75
      costGrowth: 1.5,
      maxLevel: 5,
      factorPerLevel: 0.15, // each level: factor -0.15 (15-tick car → ~13, ~11, ...)
      factorFloor: 0.4, // factor never drops below this
    },
    // One-time, garage-wide cashier hire: payouts then skip the per-pit waiting
    // pile and land straight in cash. Flat cost (no growth — it's bought once).
    cashier: {
      baseCost: 1, // TESTING: cheap for iteration (was 500)
    },
  },

  // Remote "hurry up": a temporary boost to a worker's rate (per pit).
  hurry: {
    duration: 1.2, // seconds
    multiplier: 2.5,
  },

  // Reputation: biases the incoming-car roll toward higher tiers (see Car.js
  // spawnCar + settings.carTiers). Raised permanently via the computer's Buy
  // Advertising upgrade, or doubled temporarily by watching a rewarded ad
  // (the boost refuses to re-arm while one is already running — no stacking).
  reputation: {
    baseReputation: 0.05, // starting/permanent reputation at game start
    repStep: 0.01, // +1% permanent reputation per Buy Advertising purchase
    repCap: 1.0,
    adBaseCost: 1, // TESTING: cheap for iteration, like upgrades.* above
    adGrowth: 1.5,
    boostMultiplier: 4, // rewarded-ad: multiplies effective reputation while active
    boostDurationSeconds: 3000,
  },

  // The garage's advertising terminal: tap while standing within `radius` to
  // open the Advertising panel. Lives in the left lobby (x left of pit 0's lot,
  // which starts at x ≈ -8.1) — clear of every pit lot and car lane, always
  // within owned land, reachable without crossing any lane.
  computer: {
    x: -12,
    z: 4,
    radius: 1.6,
  },

  // Where the hired cashier NPC stands (see scene/Cashier.js). Kept separate
  // from `computer` so the character can sit beside the desk rather than on it.
  // rotation is the Y-axis facing in radians.
  cashier: {
    x: -12.0,
    z: 5,
    rotation: Math.PI,
  },

  // Save/load (src/platform/storage.js). No offline-earnings catch-up — a
  // reload just restores the state as it was at the last save.
  persistence: {
    autoSaveInterval: 5, // seconds between auto-saves, on top of after-purchase saves
  },

  // Pay from finished cars waits at its own pit as a small stack of bills (see
  // scene/PitMoney.js) until the player walks up to collect (core banks it on
  // proximity). A hired cashier banks every payout straight to cash instead, so
  // no bills ever appear. Bill count shown ≈ pendingCash / cashPerBill (capped).
  money: {
    cashPerBill: 15, // pending dollars represented by each visible bill at a pit
    maxBills: 8, // cap on bills shown stacked at one pit
    billSpacing: 0.05, // y gap between stacked bills
    billScale: 0.5, // scale Money.glb down to fit scene
    flyDuration: 0.4, // seconds for bills to fly to the player on collection
  },

  // The pits: shared geometry plus a world position per pit. radius = how close
  // the player must stand to manually tap an unmanned pit.
  //
  // All five pits sit at the same z (a straight side-by-side row), spaced evenly
  // along x. The row starts at x = -6 (leaving the left lobby clear) and fills
  // out to the right as Expand Room is bought.
  pit: {
    radius: 1.7,
    driveDuration: 0.7, // seconds for any car drive tween (in/advance/out)
    // Decorative blue "pit stop" rectangle painted on the floor at each pit
    // position (approx car-sized; tune without touching scene code).
    spotWidth: 2.4,
    spotDepth: 4.4,
    // Cars drive straight THROUGH the garage (decreasing z the whole time):
    // in through a BACK-wall door (z = +halfZ) at the pit's x, and, once fixed,
    // out through a FRONT-wall door (z = -halfZ) at the same x.
    doorZ: 11.5, // entry: = world.halfZ + 1.5, just outside the back wall
    exitDoorZ: -11.5, // exit: = -(world.halfZ + 1.5), just outside the front wall
    queueSlotDepth: 5.0, // each waiting car steps this much further out (toward +z); > car length (~4.2), no overlap
    positions: [
      { x: -6, z: 4 },
      { x: -1.5, z: 4 },
      { x: 3, z: 4 },
      { x: 7.5, z: 4 },
      { x: 12, z: 4 },
    ],
  },

  // Each worker NPC stands beside its pit (offset from the pit centre, faces the car).
  mechanic: {
    offsetX: 2.1,
    offsetZ: 0.2,
    facingOffset: 0, // radians, added on top of the atan2 facing calc — flip 180° if facing is wrong
  },

  colors: {
    background: 0xf0ece4,
    floor: 0xc8c4bc, // light concrete
    lobby: 0x474f43, // the left lobby floor patch (distinct from the shop floor)
    lane: 0xb8b4ac, // slightly darker concrete strip
    grid: 0xa8a49c, // subtle grid
    wall: 0xdedad4, // off-white walls
    gate: 0xc0bbb4, // gate pillars / lintels
    lot: 0xbcb8b0, // an empty (roomUnlocked, unequipped) lot patch
    lotEdge: 0x8a8680, // outline of an empty lot
    fence: 0xe8a020, // boundary of not-yet-purchased land (Expand Room)
    landLocked: 0xb0aca4, // unpurchased land tint, beyond the fence
    pit: 0x7a6e5e, // an equipped pit station floor, darker for contrast
    pitGlow: 0xffe08a, // highlight ring when the player can repair
    toolbox: 0xc0392b, // a small toolbox marking an equipped pit
    road: 0x4a4a4a, // asphalt outside each gate + the exterior entry/exit roads
    roadLine: 0xf5e642, // yellow road-edge marking + interior floor grid lines
    laneStripe: 0xffffff, // white guide/zebra paint on the garage floor + exterior lane dashes
    pitSpot: 0x2255cc, // blue decorative pit-stop rectangle painted at each pit
    label: '#ffe08a', // pit/worker label text (CSS color string for the sprite)
    // broken car
    carBody: 0xb0433a,
    carCabin: 0x8c352e,
    carDent: 0x7a2f28,
    wheel: 0x1a1a1a,
    smoke: 0x9aa0a6,
    // advertising computer
    deskWood: 0x6b4a2f,
    computerCase: 0x23262b,
    screenGlow: 0x49d2ff,
  },
};

export default settings;
