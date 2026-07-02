/**
 * settings.js — every tunable value lives here (no Three.js imports).
 * Colors are plain hex ints so this file stays framework-agnostic.
 */
export const settings = {
  // How many parallel pits can ever exist. Pit 0 starts unlocked + equipped.
  maxPits: 5,

  // How many gas pumps can ever exist. UNLIKE pit 0, every pump starts locked:
  // the whole station (roads, pumps, gate) exists only after the first
  // Expand Station purchase (see gasStation below + core/gasStation.js).
  maxPumps: 5,

  // Garage interior bounds (character is clamped inside these on the x/z plane).
  // halfX is wide enough for the left lobby (clear of all pits) plus the five-pit
  // row to its right. Grown from the original 40.5 to double the supermarket's
  // floor footprint (width) without touching halfZ, which the car/pit doors'
  // doorZ/exitDoorZ literals are tuned against.
  world: {
    halfX: 48,
    halfZ: 10,
    wallHeight: 1.6,
    wallThickness: 0.4,
    gateHalf: 1.8, // half-width of the door gaps in the left/right walls
    // Garage approach roads + their dashed centre lines (scene/Garage.js, visual only).
    // extent = how far (world units) the roads run out from the building walls (±halfZ)
    // in z, so the lanes reach past where cars spawn / drive off and read as continuing
    // to the world edge. dashLength / dashGap tune the dashed centre line. Tune by eye
    // in `npm run dev`.
    road: {
      extent: 60,
      dashLength: 1.0,
      dashGap: 0.5,
    },
  },

  player: {
    speed: 6, // world units / second
    radius: 0.6, // used for bounds clamping
    turnLerp: 12, // higher = snappier turning
  },

  // Supermarket NPC navigation (core/pathfinding.js). A static A* walkability grid
  // is built once from the world bounds + market obstacles at this cell resolution;
  // smaller cells = finer paths but a bigger grid. Obstacles are inflated by the
  // NPC body radius (settings.player.radius) before marking, so paths never clip.
  pathfinding: {
    cellSize: 0.5, // world units per grid cell
  },

  camera: {
    viewSize: 25, // world units visible vertically (smaller = more zoomed in)
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
  // character_run.glb + character_repair.glb + character_yell.glb +
  // character_carry_run.glb + character_carry_idle.glb + character_sassy_walk.glb
  // (+ carry_walk / sitting / gasput.glb) and renames their clips to 'idle' /
  // 'walk' / 'repair' / 'yell' / 'carry' / 'carryIdle' / 'walkSlow' (/ 'carryWalk'
  // / 'sitting' / 'gaspump').
  character: {
    modelScale: 1,
    modelYRotationOffset: 0, // radians, added on top of the movement-facing rotation
    animationMap: {
      idle: 'idle',
      walk: 'walk',
      repair: 'repair',
      yell: 'yell',
      // play while player.carryingBox is true (see Character.js): 'carry'
      // while moving, 'carryIdle' while stationary — mirrors idle/walk.
      carry: 'carry',
      carryIdle: 'carryIdle',
      // genuine walking-pace clip (not the run-sourced 'walk') for NPCs that
      // move well under run speed — market customers/worker (see
      // MarketCustomer.js / MarketWorker.js) — so their legs match their feet.
      walkSlow: 'walkSlow',
      // walking-pace carry cycle: a customer hauling its bag out at walking
      // speed (MarketCustomer.js, post-checkout) — the walkSlow counterpart to
      // the run-paced 'carry'.
      carryWalk: 'carryWalk',
      // played by any worker (mechanic or market worker) while seated on a break
      // (see core/breaks.js + Mechanic.js / MarketWorker.js); sourced from
      // character_sitting.glb, merged in CharacterModel.js.
      sitting: 'sitting',
      // the pump attendant's fill action, played while servicing a car at its
      // pump (the attendant's counterpart to the mechanic's 'repair'); sourced
      // from gasput.glb, merged in CharacterModel.js.
      gaspump: 'gaspump',
    },
    crossfadeDuration: 0.25, // seconds, used for every state transition
    workerTint: 0xe07b39, // multiplies worker clone materials so they read as "the mechanic" (was mechBody)
    attendantTint: 0x9a5ac9, // purple tint for pump attendants (see scene/GasStationView.js)
    cashierTint: 0x3ad06a, // green tint for the cashier clone (see scene/Cashier.js)
    marketWorkerTint: 0x4a9fd8, // the supermarket worker clone (see scene/MarketWorker.js)
    // Each spawned customer (core/supermarket.js spawnCustomer) gets one of these,
    // never repeating the immediately preceding customer's — otherwise the one
    // walking out and the new one walking in (same model, same tint) read as the
    // same person. Distinct from workerTint/cashierTint/marketWorkerTint so a
    // customer is never mistaken for staff at a glance.
    customerTints: [0xc9956a, 0x6a8fc9, 0xc96a8a, 0x8ac96a, 0xc9b06a, 0x9a6ac9],
  },

  // Shared transform applied to every car glb when cloned (see CarView.js).
  // modelScale and modelYRotationOffset correct for glbs that import at the
  // wrong size/facing — tune once the models are visible in-scene.
  car: {
    modelScale: 1, // the per-tier glbs already bake their own ~0.01 scale; don't re-scale
    modelYRotationOffset: Math.PI, // ≈3.14 rad — cars now drive -z (door→pit); flip ±π if reversed
  },

  // The five reputation tiers, ascending (index 0 = worst, index 4 = best).
  // Higher reputation attracts higher-index cars (see Car.js spawnCar's weighted
  // roll). Each tier scales a car's repair time and payout, and has its own glb
  // model (in public/models/, preloaded + cloned per car by CarView.js).
  // baseTicks = ticksPerPart × parts × ticksMult; payout =
  // basePayoutPerPart × parts × payoutMult. STARTING VALUES — tune later.
  // modelScale is a per-tier glb size fixup (falls back to settings.car.modelScale
  // if absent); STARTING VALUES — tune after the visual check.
  carTiers: [
    { name: 'rusty', ticksMult: 0.7, payoutMult: 0.6, model: 'normalcar.glb', modelScale: 1.1 },
    { name: 'normal', ticksMult: 1.0, payoutMult: 1.0, model: 'taxi.glb', modelScale: 1.1 },
    { name: 'decent', ticksMult: 1.3, payoutMult: 1.8, model: 'SUV.glb', modelScale: 1.0 },
    { name: 'premium', ticksMult: 1.7, payoutMult: 2.8, model: 'sports.glb', modelScale: 0.75 },
    { name: 'luxury', ticksMult: 2.2, payoutMult: 4.5, model: 'cop.glb', modelScale: 1.1 },
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
  // a spawned car is routed to the pit whose index matches its reputation tier
  // (pit 0 = rusty … pit 4 = luxury; see simulation.spawnToMatchingPit) and is
  // discarded if that pit can't take it.
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
    // One-time, PER-WORKER "Upgrade Break Room": halves that worker's break
    // duration (breakDurations.base -> .upgraded) and swaps its chair for a
    // couch. Bought separately for each pit mechanic and the market worker.
    breakRoom: {
      baseCost: 1, // TESTING: cheap for iteration (was 200)
    },
    // Global "Faster Deliveries": 3 levels, each steps the supermarket restock
    // truck down one entry in settings.supermarket.truck.intervals (300→240→180
    // →120s). Geometric cost like the rest. Not per-worker — one truck serves
    // the whole market (see core/supermarket.truckDeliveryInterval).
    truckFrequency: {
      baseCost: 1, // TESTING: cheap for iteration (was 150)
      costGrowth: 1.6,
    },
    // Gas-station upgrades, mirroring the pit set 1:1 (two-stage pump unlock +
    // per-pump attendant hire/speed — see core/upgrades.js). TESTING: baseCosts
    // slashed to $1 like the rest above; restore the commented values before shipping.
    gas: {
      // Stage 1: open the next pump lot (roomUnlocked), mirrors expandRoom.
      expand: {
        baseCost: 1, // was 400
        costGrowth: 1.6,
      },
      // Stage 2: install the pump on an opened lot (equipped), mirrors pitEquipment.
      equipment: {
        baseCost: 1, // was 200
        costGrowth: 1.6,
      },
      // One-time attendant hire per pump (auto-fill + remote hurry), mirrors mechanic.
      attendant: {
        baseCost: 1, // was 80
        costGrowth: 1.5,
      },
      // Per-pump attendant speed (ticks/sec), mirrors workerSpeed.
      workerSpeed: {
        baseCost: 1, // was 60
        costGrowth: 1.6,
        maxLevel: 8,
        baseRate: 1,
        ratePerLevel: 0.5,
      },
    },
  },

  // Remote "hurry up": a temporary boost to a worker's rate (per pit).
  hurry: {
    duration: 1.2, // seconds
    multiplier: 2.5,
  },

  // Reputation: biases the incoming-car roll toward higher tiers (see Car.js
  // spawnCar + settings.carTiers). Raised permanently via the Upgrades menu's
  // Buy Advertising action, or multiplied temporarily (×boostMultiplier) by
  // watching a rewarded ad (the boost refuses to re-arm while one is already
  // running — no stacking).
  reputation: {
    baseReputation: 0.05, // starting/permanent reputation at game start
    repStep: 0.01, // +1% permanent reputation per Buy Advertising purchase
    repCap: 1.0,
    adBaseCost: 1, // TESTING: cheap for iteration, like upgrades.* above
    adGrowth: 1.5,
    boostMultiplier: 4, // rewarded-ad: multiplies effective reputation while active
    boostDurationSeconds: 3000,
  },

  // Where the hired cashier NPC stands (see scene/Cashier.js). The cashier's
  // cash-register prop (cash-register.glb) is placed here too — see
  // settings.supermarket.cashRegisterScale/Rotation. rotation is the Y-axis
  // facing in radians.
  cashier: {
    x: -47.0,
    z: 8.5,
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

  // Per-pit tire stock + the shelf/boxes that replenish it. The player carries a
  // box from a pit's shelf to its worker to refill that pit's tires; each refill
  // is one box = one full tire stack. A pit with no tires stops taking cars. The
  // one-time Mechanic Auto-Restock upgrade lets each pit's mechanic fetch a box from
  // its own shelf and refill the tire stack itself.
  storage: {
    shelfCapacity: 10, // max boxes a shelf holds (starts full)
    tiresPerBox: 20, // repairs one delivered box enables
    maxTiresPerPit: 20, // a pit's tire stack caps here (one box worth)
    autoRestockBaseCost: 500, // one-time, garage-wide mechanic auto-restock upgrade
    pickupRadius: 1.9, // how close to a shelf the player must stand to grab a box
    // Placements are offsets from each pit's position (settings.pit.positions[i]).
    shelfOffset: { x: 3.2, z: -13.5 }, // exit-door (front wall) side of the pit, clear of the exit lane
    tireOffset: { x: 2.9, z: 0.2 }, // beside the worker (mechanic.offsetX ≈ 2.1)
    // Shelf boxes are decorative: the shelf always shows a full 3-wide grid that
    // stacks upward, regardless of the actual shelfBoxes count. They render at
    // 1/5 the carried box scale.
    shelfBoxScale: 0.9,
    boxGrid: { cols: 3, spacingX: 0.5, spacingY: 0.5, baseY: 0.35 },
    carriedBoxOffset: { forward: 0.9, y: 1.3 }, // floats ahead of + above the player
    // Local placement of a worker's hand-held cardboard box during a restock haul
    // (the market worker and now the pit mechanic; applied in
    // characterAnim.attachToHand, in the hand bone's local space). Tune by eye once
    // visible; rotation is Euler radians.
    boxHandOffset: { x: 0, y: 0, z: 0 },
    boxHandRotation: { x: 0, y: 0, z: 0},
    // Per-model scale fixups (the glbs import at whatever scale they were
    // authored at — tune these by eye once visible, like settings.car.modelScale).
    shelfScale: 1,
    boxScale: 1, // carried box at full (original) scale
    tireScale: 1,

    // Collision half-extents (AABB) for the per-pit garage props, blocking ALL
    // movers (see core/collision.js buildObstacleList + the A* grid in
    // pathfinding.js). MEASURED from each glb's geometry at the scale it renders
    // at (shelfScale / tireScale = 1) — STARTING VALUES, tune by eye.
    //   shelf.glb footprint ≈ 2.06 (x) × 0.81 (z)
    garageShelfCollisionHalf: { x: 1.03, z: 0.41 },
    //   Tires.glb footprint ≈ 1.76 (x) × 1.14 (z); its mesh sits ~0.3 toward +x
    //   of the placement origin, so nudge tireOffset (not this) if it reads off-centre.
    tireCollisionHalf: { x: 0.88, z: 0.57 },
  },

  // The supermarket: a one-time unlock that turns the left lobby into a shop,
  // plus a 2-level worker upgrade (see upgrades.js). Level 0: the player does
  // both packaging (shelves -> checkout) and restocking (outside box ->
  // shelf) by hand. Level 1 ("Hire Market Worker"): the worker packages;
  // the player still restocks. Level 2 ("Train Market Worker"): the worker
  // does both, hands-free. See core/supermarket.js.
  supermarket: {
    // TESTING: cheap for iteration — restore before shipping.
    unlockBaseCost: 1, // was 800
    workerHireCost: 1, // was 250 — Hire Market Worker (workerLevel 0 -> 1)
    workerTrainCost: 1, // was 450 — Train Market Worker (workerLevel 1 -> 2)

    // Cash-register prop (cash-register.glb) that appears when the cashier is
    // hired (see scene/Cashier.js). Placed at its OWN world position (independent
    // of where the cashier NPC stands, settings.cashier) so it can be lined up by
    // eye. cashRegisterCollisionHalf is the AABB half-extent the player is pushed
    // out of (gated on state.hasCashier, see core/collision.js).
    cashRegisterScale: 2.5,
    cashRegisterRotation: Math.PI,
    cashRegisterPosition: { x: -47, y: 0, z: 6.9 },
    cashRegisterCollisionHalf: { x: 0.8, z: 0.5 },

    shelfCapacity: 20, // max units per product, per shelf; starts full once unlocked

    // TESTING: cheap for iteration (was A:8, B:6, C:11, D:15)
    products: {
      A: { price: 1, label: 'Canned Goods' },
      B: { price: 1, label: 'Snacks' },
      C: { price: 1, label: 'Frozen Pizza' },
      D: { price: 1, label: 'Ice Cream' },
    },

    customerSpawnInterval: 5, // seconds between spawns, once unlocked
    maxCustomerQueue: 5, // cap on customers in the building at once (waiting + being served)
    customerMinItems: 1,
    customerMaxItems: 5,
    customerMoveSpeed: 3.0, // world units/second
    workerMoveSpeed: 3.4, // world units/second, market worker only
    arriveEpsilon: 0.05, // distance under which a mover counts as "arrived"

    // World layout, inside the left lobby (settings.colors.lobby). Customers get
    // their OWN entry + exit doors, BOTH on the back wall (unlike a car's
    // back/front pair) — the exit sits to the entry's left (west, toward the
    // checkout/shelves corner) instead of clear across the building — see
    // Garage.js's marketEntryDoor/marketExitDoor, built the same way as a pit's
    // doors, just at fixed x's instead of per-pit. Customers drive straight
    // through on z, exactly like cars do, just slower and on foot. A third,
    // separate delivery door in the FRONT wall (deliveryDoorX, parallel to the
    // pit exit doors) is for the restock TRUCK only — it pulls up to that gate
    // from the exterior road, drops stock into the dock box just outside the
    // wall, and reverses out; never customers. STARTING VALUES — tune by eye.
    //
    // Shelf x-offsets from marketX are doubled (±6, was ±3) to double the
    // market's total floor footprint (width x depth) — world.halfX was grown
    // to make room. Depth (z) is left as-is: it's already close to the room's
    // existing front/back walls, shared with the car system's doorZ/exitDoorZ.
    marketX: -38, // entry door's x, clear of every pit lot
    marketExitX: -44, // exit door's x — same (back) wall as entry, to its left; lines up near the checkout
    customerEntryOutside: { x: -38, z: 11.5 }, // = { marketX, world.halfZ + 1.5 }, mirrors pit.doorZ
    customerExitOutside: { x: -44, z: 11.5 }, // = { marketExitX, world.halfZ + 1.5 } — same side as entry, just left of it

    deliveryDoorX: -38, // restock TRUCK's gate in the FRONT wall (z = -halfZ), in the aisle between the shelf clusters
    shelves: [
      { x: -42, z: -9, productType: 'A', model: 'shelfEnd', offset: { x: 0, z: 0 } },
      { x: -34, z: -9, productType: 'B', model: 'shelfEnd', offset: { x: 0, z: 0 } },
      { x: -44, z: -9, productType: 'C', model: 'freezer', offset: { x: 0, z: 0 } },
      { x: -32, z: -9, productType: 'D', model: 'freezer', offset: { x: 0, z: 0 } },
    ],
    // The single restock box: just OUTSIDE the front-wall delivery door
    // (deliveryDoorX), on the exterior dock where the truck pulls up — so it
    // reads as a loading dock, parallel to the pit exit doors. Anyone fetching
    // from it (player or market worker) steps out through the delivery gate:
    // core/supermarket.planRoute threads that gate into the route, and
    // simulation.clampToBounds opens the same gap for the player. Off-grid
    // (outside the room), so the final leg to it is a straight walk. Tune by eye.
    restockBoxPosition: { x: -41, z: -15.5 },

    // The restock box holds a SHARED, limited inventory (one unit restocks any
    // one shelf fully, to shelfCapacity). A delivery truck tops it back up to
    // maxUnits on a timer (see truck below + core/supermarket.tickTruck). When
    // it hits 0 the player/worker can't restock until the next truck — a
    // rewarded ad can summon one early (core/supermarket.callTruckEarly).
    restockBox: {
      maxUnits: 4,
    },

    // Delivery truck. Every `intervals[truckUpgradeLevel]` seconds it drives up
    // the front-wall exterior road to the delivery gate (deliveryDoorX), STAYS at
    // the gate (just outside the wall — it never enters the room), tops the box up
    // to restockBox.maxUnits, then reverses back out the way it came. The "Faster
    // Deliveries" upgrade (3 levels, see upgrades.js) steps the interval down this
    // array. Scene choreography (Truck.glb, loaded once) lives in scene/TruckView.js.
    // Offsets are along z (front-wall approach), relative to restockBoxPosition.
    truck: {
      // TESTING: short intervals for cheap iteration. Real: [300, 240, 180, 120].
      intervals: [30, 20, 15, 10], // seconds, index = truckUpgradeLevel (0..3)
      deliverOffset: { x: 0, z: -3.5 }, // where the truck stops: just beyond the dock box (box.z - 3.5 ≈ -19)
      startOffset: { x: 0, z: -25.5 }, // off-screen start/end point down the front road it drives in from / out to
      waitDuration: 1.5, // seconds paused at the gate before driving back out
      driveDuration: 1.6, // seconds for the drive-in / drive-out tween (mirrors a car's, slower)
      modelScale: 1, // Truck.glb size fixup — tune by eye once visible
      modelYRotationOffset: 0, // facing fixup (radians); flip ±π if it drives backwards
    },
    checkoutPosition: { x: -44.5, z: 7.596 },
    // Where the served customer actually stands to check out: in FRONT of the
    // checkout (checkoutPosition with z + 1.5), clear of its collision box, so the
    // customer never has to walk into the counter mesh — A* routes it here and it's
    // close enough to fire the checkout FSM via arriveEpsilon. Keep it in step with
    // checkoutPosition (= { checkoutPosition.x, checkoutPosition.z + 1.5 }).
    customerCheckoutSpot: { x: -44.5, z: 9.096 },
    // The market worker delivers the packaged order from this spot, offset from
    // checkoutPosition so it doesn't path into (and collide with) the customer
    // standing on the checkout centre. Added to checkoutPosition in core/supermarket.js.
    workerCheckoutOffset: { x: 1.5, z: 0 },
    workerIdleSpot: { x: -38, z: -2 },
    // queueAnchor (slot 0, nearest the checkout) sits right beside the counter, at
    // the same z; queueStep runs along x toward the entry door (there's only ~2.5
    // units of floor between the checkout and the left wall, not enough room for a
    // line of 5 if it stepped further back in z instead — see Garage.js's left
    // wall at x = -world.halfX). It used to be anchored at the door's x (z-stepped),
    // which stranded the line far from the checkout it was meant to lead into.
    queueAnchor: { x: -42.1, z: 7.6 },
    queueStep: { x: 1.4, z: 0 }, // each further-back slot steps this much further east, toward the entry door

    interactRadius: 1.8, // tap-affordance radius for shelves/checkout/restock pile (mirrors settings.pit.radius)

    // AABB collision half-extents for the solid market props (see core/collision.js).
    // Centres come from each shelf's x/z and checkoutPosition; the half-extents are
    // picked by model type. Every mover (player, worker, customers) is pushed out of
    // these. Keep them a touch under interactRadius so a mover can still get close
    // enough to tap/interact (a mover walking INTO its target obstacle is exempt).
    shelfCollisionHalf: { x: 1.5, z: 0.6 },
    freezerCollisionHalf: { x: 1.5, z: 0.6 },
    checkoutCollisionHalf: { x: 1.0, z: 0.3 },
    // Nudge a shelf/freezer's COLLISION centre independently of its visual model
    // position (applied in core/collision.js when building the obstacle list), so
    // the solid box can be lined up with the mesh's footprint without moving the
    // model. Per model type; default 0 = collision centred on the model.
    shelfCollisionOffset: { x: 0, z: 0 },
    freezerCollisionOffset: { x: 0, z: 0 },

    // Per-model scale fixups (tune by eye once visible, like settings.storage.*Scale).
    shelfScale: 1.8,
    freezerScale: 1.8,
    bagScale: 1,
    restockPileScale: 0.6,
    // Local placement of a hand-held Bag.glb (the customer's groceries after
    // checkout, and the worker's packaging bag), applied in
    // characterAnim.attachToHand in the hand bone's local space. Tune by eye once
    // visible; rotation is Euler radians.
    bagHandOffset: { x: 0, y: 0, z: 0 },
    bagHandRotation: { x: 0, y: 0, z: 15 },
  },

  // Static GLB props loaded once at startup (see scene/StorageModels.js).
  models: {
    shelf: 'shelf.glb',
    box: 'singlecardboardbox.glb',
    tires: 'Tires.glb',
    shelfEnd: 'shelf_end.glb',
    freezer: 'freezers_standing.glb',
    bag: 'Bag.glb',
    // Break-room seats: every worker gets a Chair by default; the per-worker
    // "Upgrade Break Room" purchase swaps it for the couch (see settings.breaks
    // + core/breaks.js). Loaded once, cloned per worker like the other props.
    chair: 'Chair.glb',
    couch: 'couch_small.glb',
    // The supermarket restock-delivery truck (loaded once, single reused
    // instance — see scene/TruckView.js). Drives in, drops off stock, drives out.
    truck: 'Truck.glb',
    // The hired cashier's cash-register prop (see scene/Cashier.js), placed at
    // settings.cashier and scaled/rotated by settings.supermarket.cashRegister*.
    cashRegister: 'cash-register.glb',
    // One pump prop per equipped gas-station pump (loaded once, cloned per pump
    // — see scene/GasStationView.js), placed by settings.gasStation.pumpOffset.
    gasPump: 'gas_pump.glb',
  },

  // The pits: shared geometry plus a world position per pit. radius = how close
  // the player must stand to manually tap an unmanned pit.
  //
  // All five pits sit at the same z (a straight side-by-side row), spaced evenly
  // along x. The row starts at x = -27 (leaving the left lobby clear) and fills
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
      { x: -27, z: 4 },
      { x: -13.5, z: 4 },
      { x: 0, z: 4 },
      { x: 13.5, z: 4 },
      { x: 27, z: 4 },
    ],
  },

  // Each worker NPC stands beside its pit (offset from the pit centre, faces the car).
  mechanic: {
    offsetX: 2.1,
    offsetZ: 0.2,
    facingOffset: 0, // radians, added on top of the atan2 facing calc — flip 180° if facing is wrong
  },

  // The gas station: the world's LEFT quadrant, OUTSIDE the building (x < -halfX),
  // mirroring the pit system 1:1 (see core/gasStation.js + scene/GasStationView.js).
  // Pumps sit in a row at the pits' z, extending further left; cars drive straight
  // through in -z exactly like pit cars (queue behind doorZ, exit past exitDoorZ),
  // on their own striped roads (same road/dash tunables as settings.world.road).
  // The player reaches the station through a gate in the LEFT wall at gateZ.
  gasStation: {
    radius: 1.7, // how close the player must stand to manually tap-fill an unmanned pump
    driveDuration: 0.7, // seconds for any car drive tween (in/advance/out), mirrors pit
    // Decorative pump-spot rectangle painted on the road at each pump (like pitSpot).
    spotWidth: 2.4,
    spotDepth: 4.4,
    doorZ: 11.5, // queue anchor: mirrors pit.doorZ so gas queues line up with pit queues
    exitDoorZ: -11.5, // mirrors pit.exitDoorZ
    queueSlotDepth: 5.0, // each waiting car steps this much further out (toward +z)
    positions: [
      { x: -58, z: 4 },
      { x: -66, z: 4 },
      { x: -74, z: 4 },
      { x: -82, z: 4 },
      { x: -90, z: 4 },
    ],
    // gas_pump.glb prop, placed beside each pump's car spot (offset from the pump
    // position, LEFT of the car so the attendant's spot to the right stays clear —
    // mirrors the pit's toolbox-vs-mechanic split).
    pumpOffset: { x: -2.2, z: 0 },
    // ── pump MODEL fixups — TUNE THESE BY EYE in `npm run dev` ──────────────
    // pumpModelScale:   overall size of each gas_pump.glb clone.
    // pumpModelYOffset: vertical placement; NEGATIVE sinks the model into the
    //                   ground (useful when the glb's origin floats above its base).
    // pumpYRotation:    facing; flip ±π/2 if it reads wrong against the car lane.
    pumpModelScale: 1.5,
    pumpModelYOffset: 0,
    pumpYRotation: Math.PI / 2,
    // Collision half-extents (AABB) for the pump prop, blocking all movers (see
    // core/collision.js buildObstacleList). STARTING VALUES — tune by eye.
    pumpCollisionHalf: { x: 0.6, z: 0.5 },
    // The player's gate through the LEFT wall (z position; width = world.gateHalf),
    // lined up with the pump row's z so the walk out reads straight. Closed (solid
    // wall, no pillars) until the first pump lot is bought — the station doesn't
    // exist before then.
    gateZ: 4,
    // Fill economy — independent of the repair economy. A car needs
    // fillTicks = baseTicks × tier.ticksMult; payout = basePayout × tier.payoutMult
    // (same tier scaling as repairs, own base numbers). STARTING VALUES.
    fill: {
      baseTicks: 8,
      basePayout: 12,
    },
    // Automatic spawning, mirroring settings.spawn: each pump owns its own queue.
    // UNLIKE pits there is no tier routing — a spawned car (any tier) joins the
    // shortest line among the equipped pumps and is discarded only when every
    // open pump is full (see core/gasStation.spawnToShortestQueue).
    spawn: {
      interval: 0.1, // seconds between spawns
      maxQueuePerPump: 10,
    },
  },

  // Each pump attendant stands beside its pump (offset from the pump centre,
  // faces the car) — the gas-station mirror of settings.mechanic.
  attendant: {
    offsetX: 2.1,
    offsetZ: 0.2,
    facingOffset: 0,
  },

  // How many jobs each worker completes before it earns a break (see
  // core/breaks.js). A car mechanic's job = one finished repair; the market
  // worker's job = one checked-out customer. Each worker tracks its own count.
  // TESTING: halved for cheap iteration (real values in comments).
  breakThresholds: {
    carMechanic: 50, // real: 100
    marketWorker: 25, // real: 50
    gasAttendant: 50, // one job = one filled car; real: 100
  },

  // How long (real seconds) a break lasts. The per-worker "Upgrade Break Room"
  // purchase swaps `base` for `upgraded`. TESTING: slashed to 10/5 (real in comments).
  breakDurations: {
    base: 100, // real: 300 (5 min)
    upgraded: 50, // real: 150 (2.5 min)
  },

  // Break-room layout + per-model fixups (tune by eye once visible, like the
  // storage/supermarket scales). Each worker walks to its own seat and sits
  // for breakDurations seconds; the only early wake-up is a rewarded ad.
  breaks: {
    // Mechanic seat: offset from the pit centre, placed to the right of that
    // pit's shelf (shelf is at settings.storage.shelfOffset from the pit).
    chairOffset: { x: 5.2, z: -13.0 },
    chairFacing: 0, // radians the seated mechanic (and its chair) faces
    // Attendant seat: offset from the pump centre — right next to the pump,
    // past the attendant's work spot (attendant.offsetX ≈ 2.1) and clear of the
    // car spot (spotWidth/2 = 1.2). Same chair model/facing as a mechanic's.
    pumpChairOffset: { x: 3.4, z: -1.5 },
    // Market worker seat: a fixed spot just left of the restock door, inside the room.
    marketChairPosition: { x: -47, z: -3 },
    marketChairFacing: 1.5,
    // The stationary mechanic isn't core-driven, so the scene walks it to/from
    // its chair at this pace (world units/sec) when a break starts/ends.
    mechanicWalkSpeed: 3,
    chairScale: 1,
    couchScale: 0.7,
    // Collision half-extent (AABB) for a pit break chair, blocking ALL movers
    // (see core/collision.js + pathfinding.js). MEASURED from Chair.glb (≈ 0.76 ×
    // 0.83) at chairScale = 1 — STARTING VALUE, tune by eye. The upgraded couch
    // (couch_small.glb at couchScale 0.7) is bulkier (≈ 2.0 × 1.5); bump this if
    // its corners clip through movers.
    chairCollisionHalf: { x: 0.38, z: 0.41 },
    // Once seated, nudge the worker's body relative to its seat so it rests ON
    // the seat instead of clipping into its frame — the couch is bulkier than
    // the chair, so its occupant sinks into the cushion/back without this. Per
    // seat type, applied in the seat's OWN frame (rotated by its facing):
    // `forward` = toward the seat front, `side` = across it, `lift` = raise onto
    // the cushion. Tune by eye in `npm run dev`.
    sitOffset: {
      chair: { side: 0, forward: 0, lift: 0 },
      couch: { side: 0, forward: 0.45, lift: 0 },
    },
  },

  colors: {
    background: 0xf0ece4,
    floor: 0xc8c4bc, // light concrete
    lobby: 0x474f43, // the left lobby floor patch (distinct from the shop floor)
    wall: 0xdedad4, // off-white walls
    gate: 0xc0bbb4, // gate pillars / lintels
    pit: 0x7a6e5e, // the bay/work-area floor patch, darker for contrast
    pitGlow: 0xffe08a, // highlight ring when the player can repair
    toolbox: 0xc0392b, // a small toolbox marking an equipped pit
    road: 0x4a4a4a, // asphalt outside each gate + the exterior entry/exit roads
    roadLine: 0xf5e642, // yellow divider line between adjacent pit bays
    laneStripe: 0xffffff, // white guide paint on the garage floor + exterior lane dashes
    pitSpot: 0x2255cc, // blue decorative pit-stop rectangle painted at each pit
    label: '#ffe08a', // pit/worker label text (CSS color string for the sprite)
    // supermarket checkout counter
    deskWood: 0x6b4a2f,
  },
};

// World position of every pit's break chair, index-aligned with settings.pit.positions
// (chairPositions[i] is pit i's seat). Derived from pit.positions + breaks.chairOffset
// so the two never drift — the single source of chair placement, read by both the
// scene (PitView) and the collision/pathfinding layers (see core/collision.js).
settings.breaks.chairPositions = settings.pit.positions.map((p) => ({
  x: p.x + settings.breaks.chairOffset.x,
  z: p.z + settings.breaks.chairOffset.z,
}));

// World position of every pump's break chair, index-aligned with
// settings.gasStation.positions — the attendants' mirror of chairPositions
// above, derived the same way so placement never drifts. Read by the scene
// (GasStationView) and the collision layer (core/collision.js).
settings.breaks.pumpChairPositions = settings.gasStation.positions.map((p) => ({
  x: p.x + settings.breaks.pumpChairOffset.x,
  z: p.z + settings.breaks.pumpChairOffset.z,
}));

// Half-extents (AABB) of the room's right (fence) wall — the boundary that slides
// right as pits are unlocked (its x = core ownedRightX(state), so it "appears/moves
// with upgrades"). Derived from the wall mesh in Garage.js so they never drift:
//   x = world.wallThickness/2 (the wall's half thickness)
//   z = world.halfZ + wallThickness/2 (spans the full room depth)
// Used by core/collision.js (player push-out) + the A* grid. Tune world.wallThickness
// / halfZ, not these — they recompute from it.
settings.pit.pitWallCollisionHalf = {
  x: settings.world.wallThickness / 2,
  z: settings.world.halfZ + settings.world.wallThickness / 2,
};

export default settings;
