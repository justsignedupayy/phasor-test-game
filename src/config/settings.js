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
    wallHeight: 3,
    wallThickness: 1,
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
    // Low-poly grass field (scene/GroundField.js, visual only): one static plane
    // under the whole world so the camera never sees the flat background colour.
    // Sized from halfX/halfZ + road.extent + buffer, so it always outruns both the
    // roads and the camera's follow-lerp. segments tunes the facet size; jitter is
    // the max per-vertex saturation/lightness offset around colors.grass. Tune by
    // eye in `npm run dev`.
    grass: {
      buffer: 60,
      segments: 72,
      colorJitter: 0.14,
    },
  },

  // Automatic sliding glass doors (scene/SlidingDoors.js, visual only): two
  // panels per door that part from the centre when a mover (player, customer,
  // truck) comes within range and glide shut once clear. Fitted to the walk-in
  // entrances — the gas gate, the market's customer entry/exit and the restock
  // truck's delivery gate — never the pit car doors.
  slidingDoors: {
    glassColor: 0x4aa3df, // semi-transparent blue glass panes
    glassOpacity: 0.5,
    frameColor: 0x8a9099, // grey edge bars around each pane
    panelThickness: 0.16, // door depth (y-axis of the wall plane)
    frameBar: 0.12, // thickness of the grey edge bars
    range: 5, // mover distance (world units) that triggers opening
    openDuration: 0.45, // seconds for a full open/close slide
  },

  player: {
    speed: 6, // world units / second
    radius: 0.6, // used for bounds clamping
    turnLerp: 12, // higher = snappier turning
  },

  // Static tunnel-mouth props at the supermarket's customer entry AND exit
  // (scene/Tunnels.js, visual only — no collision, no logic), so customers read
  // as EMERGING from / VANISHING into a tunnel instead of popping in/out in the
  // open. Each mouth opens toward -z (toward the corridor door); the closed dark
  // back sits on the +z side, and the spawn/despawn point is set INSIDE the dark
  // interior (see the derived customerEntry/ExitOutside below) so a customer
  // appears/disappears hidden. A short brown dirt path links each mouth to its
  // door. Frame uses the building wall colour (settings.colors.wall). STARTING
  // VALUES — tune by eye in `npm run dev`.
  tunnel: {
    wallThickness: 0.35, // side-wall + roof thickness (and the back wall's depth)
    yOffset: 0, // base sits on the ground; raise/lower the whole prop here
    interiorColor: 0x14140f, // near-black back/interior — reads as a dark tunnel recess
    // Tunnel box, sized for a single walking customer (taller/wider than a body).
    customer: { width: 3.0, height: 2.8, depth: 3.4 },
    // Placement (used to derive the spawn/despawn + mouth points in the block at
    // the bottom of this file): a mouth sits mouthGap beyond the corridor door, and
    // the spawn/despawn point spawnInset deeper still (inside the dark). Entry and
    // exit sit equally far out, so the customer walks the full dirt path both in and out.
    mouthGap: 16, // z distance from a corridor door out to its tunnel mouth (its dirt-path length); shared by entry + exit
    spawnInset: 1.7, // how far inside the mouth the spawn/despawn point sits (< customer.depth)
    // Brown dirt path from each tunnel mouth to its door.
    dirtColor: 0x6b4f34,
    pathWidth: 2.2, // width (x) of the dirt path strip
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
    headHeight: 2.3, // STARTING VALUE — tune by eye; shared by the player + every worker (same base model)
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
      // played by any worker (mechanic or market worker) while on a break,
      // leaning against the wall (see core/breaks.js + Mechanic.js /
      // MarketWorker.js); sourced from character_resting.glb, merged in
      // CharacterModel.js.
      resting: 'resting',
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

  // Reaction emotes ('💢'/'❗') popped above a character's head on a remote
  // hurry tap (see main.js's showHurryEmotes + scene/popup.js's
  // showEmotePopup). STARTING VALUES — tune by eye in npm run dev.
  emote: {
    heightAboveHead: 0.6, // world units added on top of character.headHeight
    fontSize: 26, // px
  },

  // Shared transform applied to every car glb when cloned (see CarView.js).
  // modelScale and modelYRotationOffset correct for glbs that import at the
  // wrong size/facing — tune once the models are visible in-scene.
  car: {
    modelScale: 1, // the per-tier glbs already bake their own ~0.01 scale; don't re-scale
    modelYRotationOffset: Math.PI, // ≈3.14 rad — cars now drive -z (door→pit); flip ±π if reversed
    // Where a damaged car's smoke plumes emit from, relative to the car root.
    // Cars drive -z (door→pit, see pit.doorZ/exitDoorZ), so the HOOD is on the
    // -z side of root — don't flip these signs without re-checking drive
    // direction. STARTING VALUES, tune by eye in npm run dev.
    engineSmokeOffset: { x: 0, y: 0.7, z: -2.0 }, // engine bay: at the grille, sitting on the hood surface
    hoodSmokeOffset: { x: 0, y: 0.8, z: -1.6 }, // hood surface: front, ahead of the windshield
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
    tapTicks: 5, // ticks added per manual repair tap (≈ a worker's base rate)
  },

  // Automatic spawning. Each pit owns its own waiting queue (no shared lane);
  // a spawned car is routed to the pit whose index matches its reputation tier
  // (pit 0 = rusty … pit 4 = luxury; see simulation.spawnToMatchingPit) and is
  // discarded if that pit can't take it.
  //
  // 5× TRAFFIC REBALANCE: interval ÷5 (5 → 1) for 5× the visual traffic, with
  // per-car payout ÷5 and worker/attendant rates ×5 (plus driveDuration,
  // tiresPerBox and breakThresholds scaled to match) so cars flow 5× faster at
  // 1/5 the value each — $/min and the whole progression pace are unchanged.
  spawn: {
    interval: 1, // seconds between spawns — paces the whole repair economy
    maxQueuePerPit: 10, // max cars waiting per pit's own queue
    basePayoutPerPart: 4, // payout = basePayoutPerPart × numParts (3-damage car = $12)
  },

  // Two-stage room unlock + the per-pit upgrades. All costs are geometric
  // (cost = baseCost × costGrowth^level); see upgrades.js for the level used.
  //
  // Balance anchors: an average rusty car pays ~$4.80 every ~1.6s of pit-0 work
  // (the 5×-traffic rebalance kept $/min flat; the later flat 4× payout raise
  // and 3× cost raise moved both sides together); each new income stream
  // (pit land + equipment + mechanic) costs roughly a few minutes of the income
  // that came before it; the gas tier is priced against the full-garage income it
  // is gated behind (see upgrades.gas below).
  upgrades: {
    // Stage 1: add empty floor space (reveals the next lot).
    expandRoom: {
      baseCost: 900,
      costGrowth: 1.6,
    },
    // Stage 2: install the repair station on a roomUnlocked lot. Scales by pit index.
    pitEquipment: {
      baseCost: 450,
      costGrowth: 1.6,
    },
    // One-time worker hire per pit (enables auto-repair + remote hurry). Scales by index.
    mechanic: {
      baseCost: 180,
      costGrowth: 1.5,
    },
    // Per-pit worker speed (ticks/sec).
    workerSpeed: {
      baseCost: 150,
      costGrowth: 1.6,
      maxLevel: 8,
      baseRate: 5, // ticks/sec at level 0 → a 15-tick car takes ~3s (5× traffic pace)
      ratePerLevel: 2.5, // +ticks/sec per level
    },
    // Per-pit fixing time: lowers the fix-time factor (≤1), shrinking required ticks.
    fixingTime: {
      baseCost: 225,
      costGrowth: 1.5,
      maxLevel: 5,
      factorPerLevel: 0.15, // each level: factor -0.15 (15-tick car → ~13, ~11, ...)
      factorFloor: 0.4, // factor never drops below this
    },
    // One-time, garage-wide cashier hire: payouts then skip the per-pit waiting
    // pile and land straight in cash. Flat cost (no growth — it's bought once).
    cashier: {
      baseCost: 1500,
    },
    // Global "Faster Deliveries": 3 levels, each steps the ORDERED restock
    // truck's delivery time down one entry in settings.supermarket.truck
    // .deliveryTimes (300→240→180→120s from order to arrival); the FINAL level
    // additionally auto-places an order the instant the restock box runs dry.
    // Geometric cost like the rest. Not per-worker — one truck serves the whole
    // market (see core/supermarket.truckDeliveryTime / orderTruck / tickTruck).
    truckFrequency: {
      baseCost: 450,
      costGrowth: 1.6,
    },
    // Per-worker-TYPE "Shorter Breaks": each level HALVES the break duration
    // (breakDurations.base 300s → 150s → 75s at maxLevel 2 — see
    // core/breaks.breakDurationAtLevel). ONE purchase covers every worker of
    // that type (all pit mechanics / the market worker / all pump attendants),
    // so each type is priced above its per-worker upgrades; the attendant tier
    // carries the usual endgame markup. Geometric cost like the rest.
    breakDuration: {
      maxLevel: 2,
      carMechanic: { baseCost: 1000, costGrowth: 1.8 },
      marketWorker: { baseCost: 800, costGrowth: 1.8 },
      gasAttendant: { baseCost: 5000, costGrowth: 1.8 },
    },
    // One-time "Player Speed" purchase (the tablet's Player tab): permanently
    // multiplies settings.player.speed (see simulation.updatePlayer via
    // upgrades.playerSpeedMultiplier). Flat cost — bought once, no growth.
    playerSpeed: {
      baseCost: 2000,
      multiplier: 1.3,
    },
    // Gas-station upgrades, mirroring the pit set 1:1 (two-stage pump unlock +
    // per-pump attendant hire/speed — see core/upgrades.js). Priced well above
    // the pit equivalents: the station only unlocks once the garage + market are
    // fully built out (see upgrades.gasStationPrereqs), so these are endgame
    // sinks against a full multi-stream income.
    gas: {
      // Stage 1: open the next pump lot (roomUnlocked), mirrors expandRoom.
      expand: {
        baseCost: 6000,
        costGrowth: 1.6,
      },
      // Stage 2: install the pump on an opened lot (equipped), mirrors pitEquipment.
      equipment: {
        baseCost: 3000,
        costGrowth: 1.6,
      },
      // One-time attendant hire per pump (auto-fill + remote hurry), mirrors mechanic.
      attendant: {
        baseCost: 1200,
        costGrowth: 1.5,
      },
      // Per-pump attendant speed (ticks/sec), mirrors workerSpeed.
      workerSpeed: {
        baseCost: 750,
        costGrowth: 1.6,
        maxLevel: 8,
        baseRate: 5,
        ratePerLevel: 2.5,
      },
    },
  },

  // Remote "hurry up": a temporary boost to a worker's rate (per pit).
  hurry: {
    duration: 1.2, // seconds
    multiplier: 2.5,
  },

  // Reputation: biases the incoming-car roll toward higher tiers (see Car.js
  // spawnCar + settings.carTiers). Raised permanently two ways: the Upgrades
  // menu's Buy Advertising action (cash), or watching a rewarded ad (free, but
  // rate-limited by adCooldownSeconds). Both add a permanent step — there is no
  // temporary multiplier.
  reputation: {
    baseReputation: 0.05, // starting/permanent reputation at game start
    // +5% permanent reputation per Buy Advertising purchase: 19 buys from base to
    // cap. Chunky on purpose — at adGrowth 1.5 a +1% step would make the higher
    // pit reputation gates (settings.pit.unlockReputation) astronomically
    // expensive; at +5% the last gate (70%) is 13 buys (~$15K cumulative) and the
    // cap is a long-tail sink (~$180K cumulative).
    repStep: 0.05,
    repCap: 1.0,
    adBaseCost: 120,
    adGrowth: 1.5,
    // Watch Ad (rewarded): grants a PERMANENT +adRewardStep reputation for free,
    // then locks the button for adCooldownSeconds (see core/reputation.js
    // watchAdForReputation / updateReputationTimer + state.adCooldownRemaining).
    adRewardStep: 0.05, // +5% permanent reputation per rewarded-ad view
    adCooldownSeconds: 1800, // 30-minute cooldown between Watch Ad uses
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

  // Physical unlock markers: every "create a location / hire a worker" purchase
  // (expand/equip a pit or pump lot, hire mechanic/attendant/cashier/market
  // worker, open the market or gas station) is bought IN the world — a white
  // ground circle + cost label at the spot the purchase creates, tapped while
  // standing in range. Tuning upgrades stay in the phone menu. The marker list
  // itself is derived per-frame in core/upgrades.getUnlockMarkers; the scene
  // renders it in scene/UnlockMarkers.js.
  unlockMarkers: {
    radius: 1.0, // ground circle radius (world units)
    labelHeight: 1.6, // cost label height above the circle
    // Hire markers sit on the lane in FRONT of their pit/pump (offset from its
    // centre): clear of the car spot (z ≈ ±2.2 around the centre), the tire
    // stack (x+2.9, z+0.2) and the pump prop (x+2, z+1.1).
    hireOffset: { x: 2.1, z: -3.2 },
    // The "Open Gas Station" marker stands just INSIDE the left wall at the
    // future gate's z — the pump row is unreachable until the station exists.
    gasEntryInset: 1.7,
    // …and its label floats HIGHER than the standard labelHeight: the cashier
    // marker's label sits ~3 world units away at the register and the two
    // otherwise overlap on the isometric camera. Tune by eye.
    gasEntryLabelHeight: 2.8,
    interactRadius: 1.8, // proximity range that pays a marker down, mirrors supermarket.interactRadius
    // Standing in range drains the cost CONTINUOUSLY at cost/unlockDuration per
    // second, so every unlock takes exactly unlockDuration seconds regardless
    // of price (see scene/UnlockMarkers.js) — a $180 hire drains $36/s, a $6000
    // gas lot $1200/s. The drain only begins after startDelay seconds in the
    // circle — required again on every re-entry. Cash already drained is KEPT
    // (not refunded) when the player leaves; the label shows the remaining
    // balance and a later visit resumes from it. The flying bills are cosmetic
    // pacing on top of the continuous drain.
    startDelay: 1, // seconds standing in a marker before the drain starts (each entry)
    unlockDuration: 5, // seconds of standing in a marker to complete ANY unlock
    billInterval: 0.08, // seconds between cosmetic bill flights while draining
    billFlyDuration: 0.15, // seconds for one bill's flight from player to marker
  },

  // Pay from finished cars waits at its own pit as a small stack of bills (see
  // scene/PitMoney.js) until the player walks up to collect (core banks it on
  // proximity). A hired cashier banks every payout straight to cash instead, so
  // no bills ever appear. Bill count shown ≈ pendingCash / cashPerBill (capped).
  money: {
    cashPerBill: 15, // pending dollars represented by each visible bill at a pit
    maxBills: 40, // cap on bills shown stacked at one pit (raised 5× from 8 so big piles read)
    billSpacing: 0.05, // y gap between stacked bills
    billScale: 0.5, // scale Money.glb down to fit scene
    flyDuration: 0.4, // seconds for bills to fly to the player on collection
    cashTintColor: 0x5fd98b, // multiplies Money.glb materials so the stacks read green (see scene/PitMoney.js)
  },

  // Per-pit tire stock + the shelf/boxes that replenish it. The player carries a
  // box from a pit's shelf to its worker to refill that pit's tires; each refill
  // is one box = one full tire stack. A pit with no tires stops taking cars. The
  // one-time Mechanic Auto-Restock upgrade lets each pit's mechanic fetch a box from
  // its own shelf and refill the tire stack itself.
  storage: {
    shelfCapacity: 10, // max boxes a shelf holds (starts full)
    // ×5 with the spawn rate: repairs (each burning one tire) complete 5× as
    // often, so a box lasts the same wall-clock time as before (~2 minutes).
    tiresPerBox: 100, // repairs one delivered box enables
    maxTiresPerPit: 100, // a pit's tire stack caps here (one box worth)
    autoRestockBaseCost: 1500, // one-time, garage-wide mechanic auto-restock upgrade
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
    unlockBaseCost: 2400,
    workerHireCost: 750, // Hire Market Worker (workerLevel 0 -> 1)
    workerTrainCost: 1350, // Train Market Worker (workerLevel 1 -> 2)

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

    // A customer order is 1-5 items, so an average basket pays ~$30.
    products: {
      A: { price: 8, label: 'Canned Goods' },
      B: { price: 6, label: 'Snacks' },
      C: { price: 11, label: 'Frozen Pizza' },
      D: { price: 15, label: 'Ice Cream' },
    },

    customerSpawnInterval: 5, // seconds between spawns, once unlocked
    maxCustomerQueue: 6, // cap on customers in the building at once (waiting + being served)
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
    // Both customer openings extend OUTWARD from the back wall as walled
    // corridors this long, with the actual door (frame + sliding glass) at the
    // FAR end — the building wall keeps its gap as the corridor mouth. Gives
    // customers walking room before the queue slots (which don't move). The
    // door plane (customerDoorZ) and the spawn/despawn points
    // (customerEntryOutside / customerExitOutside) are derived from this at the
    // bottom of the file, so this one number is the whole tune-by-eye knob.
    customerCorridorLength: 4,

    deliveryDoorX: -38, // restock TRUCK's gate in the FRONT wall (z = -halfZ), in the aisle between the shelf clusters
    // The delivery/restock opening gets the same corridor treatment on the FRONT
    // wall: a walled corridor this long with the door (frame + sliding glass) at
    // the far end — deliveryDoorZ / deliveryDoorOutside are derived at the bottom
    // of the file. Keeps the automatic door clear of the shelf aisles (z ≈ -9) so
    // a worker restocking a shelf never trips it; only an actual walk down the
    // corridor does. Tune by eye in `npm run dev`.
    deliveryCorridorLength: 3,
    shelves: [
      { x: -41, z: -9, productType: 'A', model: 'shelfEnd', offset: { x: 0, z: 0 } },
      { x: -35, z: -9, productType: 'B', model: 'shelfEnd', offset: { x: 0, z: 0 } },
      { x: -45, z: -9, productType: 'C', model: 'freezer', offset: { x: 0, z: 0 } },
      { x: -31, z: -9, productType: 'D', model: 'freezer', offset: { x: 0, z: 0 } },
    ],
    // The single restock box: just OUTSIDE the front-wall delivery door
    // (deliveryDoorX), on the exterior dock where the truck pulls up — so it
    // reads as a loading dock, parallel to the pit exit doors. Anyone fetching
    // from it (player or market worker) steps out through the delivery gate:
    // core/supermarket.planRoute threads that gate into the route, and
    // simulation.clampToBounds opens the same gap for the player. Off-grid
    // (outside the room), so the final leg to it is a straight walk. Tune by eye.
    restockBoxPosition: { x: -42, z: -14.5 },

    // The restock box holds a SHARED, limited inventory (one unit restocks any
    // one shelf fully, to shelfCapacity). A delivery truck tops it back up to
    // maxUnits on a timer (see truck below + core/supermarket.tickTruck). When
    // it hits 0 the player/worker can't restock until the next truck — a
    // rewarded ad can summon one early (core/supermarket.callTruckEarly).
    restockBox: {
      maxUnits: 4,
    },

    // Delivery truck. The truck is idle until a delivery is ORDERED (the phone
    // menu's Order Truck row / the empty-box panel — core/supermarket.orderTruck);
    // deliveryTimes[truckUpgradeLevel] seconds later it drives up the front-wall
    // exterior road to the delivery gate (deliveryDoorX), STAYS at the gate (just
    // outside the wall — it never enters the room), tops the box up to
    // restockBox.maxUnits, then reverses back out the way it came. The "Faster
    // Deliveries" upgrade (3 levels, see upgrades.js) steps the post-order wait
    // down this array; at the FINAL level an order is placed automatically the
    // instant the box runs dry. Scene choreography (Truck.glb, loaded once) lives
    // in scene/TruckView.js. Offsets are along z (front-wall approach), relative
    // to restockBoxPosition.
    truck: {
      deliveryTimes: [300, 240, 180, 120], // seconds from order to arrival, index = truckUpgradeLevel (0..3)
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
    // The "Hire the market worker" unlock marker's OWN spot (it used to share
    // workerIdleSpot): open floor east of centre, clear of the customer entry
    // lane (x -38), exit lane (x -44), the shelf row (z -9) and the checkout
    // queue (z 7.6). The worker still SPAWNS/idles at workerIdleSpot. Tune by eye.
    hireWorkerMarkerSpot: { x: -35, z: 2 },
    // queueAnchor (slot 0, nearest the checkout) sits right beside the counter, at
    // the same z; queueStep runs along x toward the entry door (there's only ~2.5
    // units of floor between the checkout and the left wall, not enough room for the
    // line if it stepped further back in z instead — see Garage.js's left
    // wall at x = -world.halfX). It used to be anchored at the door's x (z-stepped),
    // which stranded the line far from the checkout it was meant to lead into.
    // queueSlotPosition (core/supermarket.js) derives every slot from these two, so
    // maxCustomerQueue can change without touching layout: the 6-slot line runs
    // x -42.1 → -35.1 (up to about the entry door), clear of pit 0's lane.
    queueAnchor: { x: -42.1, z: 7.6 },
    queueStep: { x: 1.4, z: 0 }, // each further-back slot steps this much further east, toward the entry door

    interactRadius: 1.8, // tap-affordance radius for shelves/checkout/restock pile (mirrors settings.pit.radius)

    // Visual tile grid painted over the market's (lobby) floor once it opens —
    // square cells this many world units across, drawn as thin painted lines in
    // the lane-marking style (see Garage.#buildMarketFloorGrid). Tune by eye.
    floorTileSize: 2,

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
    shelfScale: 2.5,
    freezerScale: 2.5,
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
    // playerPresent range from the pit centre (manual repair ticks, box delivery,
    // cash pickup, tap-repair). The pit-lane walls (settings.pitLane) keep the
    // player at least halfWidth + player.radius ≈ 1.8 from the centre, so this
    // must reach past them.
    radius: 2.4,
    // Reputation gate per pit, index-aligned with positions: opening pit i's land
    // (Expand Room) requires permanentReputation >= unlockReputation[i] ON TOP OF
    // the cash cost (see upgrades.buyExpandRoom). Fractions of repCap — shown as
    // % in the Upgrades menu (0.10 = 10%). Pit 0 starts owned, so its 0 is moot.
    unlockReputation: [0, 0.1, 0.3, 0.5, 0.7],
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
    // How close the player must stand to manually tap-fill an unmanned pump.
    // The lane walls (settings.pitLane, shared with the pits) hold the player at
    // least halfWidth + player.radius ≈ 1.8 from the lane centre, so this must
    // exceed that — 2.4 mirrors settings.pit.radius, raised for the same reason.
    radius: 2.4,
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
    pumpOffset: { x: 2, z: 1.1 },
    // ── pump MODEL fixups — TUNE THESE BY EYE in `npm run dev` ──────────────
    // pumpModelScale:   overall size of each gas_pump.glb clone.
    // pumpModelYOffset: vertical placement; NEGATIVE sinks the model into the
    //                   ground (useful when the glb's origin floats above its base).
    // pumpYRotation:    facing; flip ±π/2 if it reads wrong against the car lane.
    pumpModelScale: 1.5,
    // gas_pump.glb's origin is at its vertical CENTER (geometry minY ≈ -0.6435),
    // so the base sits at y=0 only when lifted by 0.6435 × pumpModelScale.
    // Recompute if pumpModelScale changes.
    pumpModelYOffset: 0.6435 * 1.5,
    pumpYRotation: Math.PI / 2,
    // Multiplied into every gas_pump.glb material's base colour (see
    // scene/GasStationView.js #buildPump) so the pumps read red.
    pumpTintColor: 0xd03a2a,
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
      basePayout: 9.6, // 2.4 × 4 (the flat 4× payout raise on top of the 5×-traffic rebalance)
    },
    // Automatic spawning, mirroring settings.spawn: each pump owns its own queue.
    // UNLIKE pits there is no tier routing — a spawned car (any tier) joins the
    // shortest line among the equipped pumps and is discarded only when every
    // open pump is full (see core/gasStation.spawnToShortestQueue).
    spawn: {
      interval: 1, // seconds between spawns, mirrors settings.spawn.interval
      maxQueuePerPump: 10,
    },
  },

  // Per-lane car-lane fencing + the raised pedestrian crossings over the
  // lanes, for BOTH lane kinds: each pit's interior lane and each gas pump's
  // road (geometry in core/roads.js pitLaneBoxes / pumpLaneBoxes /
  // laneBridgeCrossings / laneBridgeElevationAt; the wall boxes ride with the
  // other per-pit/per-pump props in core/collision.js buildObstacleList;
  // meshes in scene/Bridges.js). Once a pit/pump is EQUIPPED (cars start
  // driving its lane), the lane's full depth is walled off to walking movers
  // by an invisible strip — its long faces are the walls along both lane
  // edges, filled solid so the bridge gap can't be used to wander up the lane
  // at grade — split only at the bridge corridor: the raised deck just past
  // the pit's/pump's hire marker (on the far side from it) is the ONE way
  // across. Cars are NOT movers: they tween straight through underneath,
  // completely unaffected. Each PIT gets its own small bridge (ramp up, flat
  // deck, ramp down along x); the PUMP row instead gets ONE elevated SPINE:
  // a single flat walkway at constant bridge height running the row's full
  // length along the crossing corridor (no up/down along its length), with a
  // short perpendicular SPUR at each pump — a steep stair-like descent off the
  // spine's pump side, down to that pump's ground (see `spine` below and
  // core/roads.pumpSpineLayout). The spine's outer ends are closed (rail +
  // cap box — past the LAST pump nothing lies beyond the row, and the garage
  // end is entered via pump 0's spur, not head-on); railings on the spine and
  // every spur are SOLID, so the only ways on/off are the spur mouths. Simple
  // primitive geometry in the grey road/floor palette; the player model is
  // lifted by laneBridgeElevationAt while on the structure (visual only —
  // core positions stay 2D). STARTING VALUES, tune by eye.
  pitLane: {
    halfWidth: 1.2, // lane half-extent in x — the invisible walls' faces; just covers the car/pump spot (spotWidth / 2)
    bridge: {
      zOffset: -2.4, // deck centre z relative to the lane's HIRE MARKER (negative = past it, away from the pit/pump)
      width: 2.0, // deck depth (z); also the gap carved through the lane walls
      height: 2.0, // deck walking surface y — clears a car's roof
      thickness: 0.2,
      rampLength: 1.5, // horizontal run of each PIT bridge end ramp — short, so the tips stay clear of the mechanics' break-spot/shelf walks (x ≈ pit.x + 2.9)
      railHeight: 0.6,
      deckColor: 0x9aa0a8,
      railColor: 0x646a73,
    },
    // The pump row's spine walkway (shares the bridge's width/height/thickness/
    // rail/colour values above; the spine runs at the same corridor z the lane
    // walls are gapped at). Spur placement threads the fixed spots in each
    // pump's ground strip: the hire marker (pump.x+2.1), the attendant's break
    // spot (pump.x+3.4, z+2.5) and the pump prop (x+2, z+5.1) — the mouth must
    // leave a player-radius(0.6)-wide path past the break spot.
    spine: {
      spurOffsetX: 4.8, // spur centre x relative to its pump — the garage (+x) side of its lane, past the break spot, short of the next lane
      spurWidth: 1.8, // spur deck width (x); also the gap in the spine's pump-side railing
      spurLength: 1.2, // horizontal run (z) of a spur's descent — short and steep (stair-like), so the mouth clears the break-spot walk
      endPad: 0.3, // the spine deck continues this far past an end junction before its closing rail
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
  // Car-servicing thresholds are ×5 with the spawn rate (jobs complete 5× as
  // often, so breaks-per-hour stay unchanged); the market worker's is untouched
  // because customer traffic (customerSpawnInterval) didn't change.
  breakThresholds: {
    carMechanic: 500,
    marketWorker: 50,
    gasAttendant: 500, // one job = one filled car
  },

  // How long (real seconds) a break lasts.
  breakDurations: {
    base: 300, // 5 min
  },

  // Break-spot layout: each worker walks to its own wall-side spot and leans
  // against the wall for breakDurations seconds; the only early wake-up is a
  // rewarded ad. No furniture — the spots are bare floor by a wall.
  breaks: {
    // Mechanic break spot: offset from the pit centre, to the right of that
    // pit's shelf (shelf is at settings.storage.shelfOffset from the pit),
    // against the front wall.
    breakSpotOffset: { x: 5.2, z: -13.0 },
    breakSpotFacing: 0, // radians the resting mechanic faces at its spot
    // Attendant break spot: offset from the pump centre — right next to the
    // pump, past the attendant's work spot (attendant.offsetX ≈ 2.1) and clear
    // of the car spot (spotWidth/2 = 1.2). Same facing as a mechanic's.
    pumpBreakSpotOffset: { x: 3.4, z: -1.5 },
    // Market worker break spot: a fixed spot just left of the restock door, inside the room.
    marketBreakSpot: { x: -47, z: -3 },
    marketBreakSpotFacing: 1.5,
    // The stationary mechanic isn't core-driven, so the scene walks it to/from
    // its break spot at this pace (world units/sec) when a break starts/ends.
    mechanicWalkSpeed: 3,
    // Once on break, nudge the worker's body relative to its break spot so it
    // leans upright against the wall instead of standing in open space. Applied
    // in the spot's OWN frame (rotated by its facing): `forward` = toward the
    // wall, `side` = across it, `lift` = raise/lower. STARTING VALUE — tune by
    // eye, worker leaning upright against the wall, no furniture to sink into.
    leanOffset: { side: 0, forward: 0, lift: 0 },
  },

  colors: {
    background: 0xf0ece4,
    floor: 0xc8c4bc, // light concrete
    lobby: 0x474f43, // the left lobby floor patch (distinct from the shop floor)
    marketTileLine: 0x555e50, // the market floor's tile-grid lines, a shade lighter than the lobby they sit on
    wall: 0xdedad4, // off-white walls
    gate: 0xc0bbb4, // gate pillars / lintels
    pit: 0x7a6e5e, // the bay/work-area floor patch, darker for contrast
    pitGlow: 0xffe08a, // highlight ring when the player can repair
    toolbox: 0xc0392b, // a small toolbox marking an equipped pit
    grass: 0x8fae7a, // soft muted green for the exterior ground field (scene/GroundField.js)
    road: 0x4a4a4a, // asphalt outside each gate + the exterior entry/exit roads
    roadLine: 0xf5e642, // yellow divider line between adjacent pit bays
    laneStripe: 0xffffff, // white guide paint on the garage floor + exterior lane dashes
    pitSpot: 0x2255cc, // blue decorative pit-stop rectangle painted at each pit
    label: '#ffe08a', // pit/worker label text (CSS color string for the sprite)
    // supermarket checkout counter
    deskWood: 0x6b4a2f,
  },
};

// World position of every pit's break spot, index-aligned with settings.pit.positions
// (breakSpots[i] is where pit i's worker rests). Derived from pit.positions +
// breaks.breakSpotOffset so the two never drift — the single source of break-spot
// placement, read by core/simulation.js's break-walk and the render lean.
settings.breaks.breakSpots = settings.pit.positions.map((p) => ({
  x: p.x + settings.breaks.breakSpotOffset.x,
  z: p.z + settings.breaks.breakSpotOffset.z,
}));

// World position of every pump's break spot, index-aligned with
// settings.gasStation.positions — the attendants' mirror of breakSpots above,
// derived the same way so placement never drifts (core/gasStation.js).
settings.breaks.pumpBreakSpots = settings.gasStation.positions.map((p) => ({
  x: p.x + settings.breaks.pumpBreakSpotOffset.x,
  z: p.z + settings.breaks.pumpBreakSpotOffset.z,
}));

// The gas station's far (left) outer edge — an invisible wall so the player can
// never walk off the west side of the world (core/simulation.clampToBounds holds
// the player's x at or right of this). Derived from the pump row: the LAST
// pump's road slab edge, i.e. half a lane-width past the leftmost pump (the same
// lane width core/roads.js derives from the pump spacing), so it tracks the
// station if pumps are ever moved or added.
{
  const xs = settings.gasStation.positions.map((p) => p.x);
  const lane = xs.length > 1 ? Math.abs(xs[1] - xs[0]) : 4.5;
  settings.gasStation.leftLimitX = Math.min(...xs) - lane / 2;
}

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

// Customer entry/exit door plane: the FAR end of each corridor, a
// customerCorridorLength beyond the back wall's own (relocated) opening —
// Garage.js (door frames + corridor walls) and scene/SlidingDoors.js (glass
// panels) both anchor here, derived so they can never drift apart.
settings.supermarket.customerDoorZ =
  settings.world.halfZ + settings.world.wallThickness / 2 + settings.supermarket.customerCorridorLength;

// The customer tunnels (scene/Tunnels.js) sit BACK from the door: each mouth is
// tunnel.mouthGap beyond customerDoorZ, and the spawn/despawn point is
// tunnel.spawnInset deeper still — INSIDE the dark interior — so a customer
// emerges from / vanishes into the tunnel rather than in the open (the despawn on
// arrival at customerExitOutside now lands the customer hidden inside the exit
// tunnel). customerEntry/ExitTunnelMouth are the mouth centres the props anchor
// to; a dirt path links each mouth back to customerDoorZ.
{
  const inset = settings.tunnel.spawnInset;
  const mouthZ = settings.supermarket.customerDoorZ + settings.tunnel.mouthGap;
  settings.supermarket.customerEntryOutside = { x: settings.supermarket.marketX, z: mouthZ + inset };
  settings.supermarket.customerExitOutside = { x: settings.supermarket.marketExitX, z: mouthZ + inset };
  settings.supermarket.customerEntryTunnelMouth = { x: settings.supermarket.marketX, z: mouthZ };
  settings.supermarket.customerExitTunnelMouth = { x: settings.supermarket.marketExitX, z: mouthZ };
}

// The delivery gate's mirror of the customer block above, on the FRONT wall:
// the door plane at the far end of its corridor, plus the outside turn-point
// movers walk to before heading for the restock box/dock (and back). The same
// 1.5 margin past the door as the customer points — far enough out that the
// lateral leg to the box clears the corridor walls and the retracted door
// panels (which park flush with the door plane when open).
settings.supermarket.deliveryDoorZ =
  -(settings.world.halfZ + settings.world.wallThickness / 2 + settings.supermarket.deliveryCorridorLength);
settings.supermarket.deliveryDoorOutside = {
  x: settings.supermarket.deliveryDoorX,
  z: -(settings.world.halfZ + settings.supermarket.deliveryCorridorLength + 1.5),
};

export default settings;
