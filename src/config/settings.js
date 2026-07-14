// settings.js — every tunable value (no Three.js imports; colors are plain hex ints).
export const settings = {
  maxPits: 5,

  maxPumps: 5,

  world: {
    halfX: 48,
    halfZ: 10,
    wallHeight: 3,
    wallThickness: 1,
    gateHalf: 1.8, // half-width of the door gaps in the left/right walls
    road: {
      extent: 60,
      dashLength: 1.0,
      dashGap: 0.5,
    },
    grass: {
      buffer: 60,
      segments: 72,
      colorJitter: 0.1, // kept gentle — big saturation swings made the field look artificial
    },
    surfaceTexture: {
      grassTile: 11,
      roadTile: 6,
      floorTile: 9,
      grassBumpScale: 0.6,
      roadBumpScale: 0.8,
      floorBumpScale: 0.25,
      dirtTint: 0xd9c9ab,
      brickWidth: 1.1, // one brick's world-unit length along the wall
      brickHeight: 0.42, // one course's world-unit height (~7 courses on a 3-high wall)
      brickColor: 0xbfa38a, // warm sandy brick
      mortarColor: 0xd6d0c6, // light grey joints, a touch brighter than the bricks
      brickBumpScale: 0.5,
    },
  },

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

  tunnel: {
    wallThickness: 0.35, // side-wall + roof thickness (and the back wall's depth)
    yOffset: 0, // base sits on the ground; raise/lower the whole prop here
    interiorColor: 0x14140f, // near-black back/interior — reads as a dark tunnel recess
    customer: { width: 3.0, height: 2.8, depth: 40 },
    mouthGap: 16, // z distance from a corridor door out to its tunnel mouth (its dirt-path length); shared by entry + exit
    spawnInset: 1.7, // how far inside the mouth the spawn/despawn point sits (< customer.depth)
    dirtColor: 0x6b4f34,
    pathWidth: 2.2, // width (x) of the dirt path strip
  },

  pathfinding: {
    cellSize: 0.5, // world units per grid cell
  },

  camera: {
    viewSize: 25, // world units visible vertically (smaller = more zoomed in)
    distance: 40, // ortho position scale; does NOT change apparent size
    near: 0.1,
    far: 200,
    followLerp: 5, // how fast the camera eases toward the player each second (higher = snappier)
    portraitMaxStretch: 1.6, // STARTING VALUE — tune by eye (max vertical frustum = viewSize × this)
    portraitZoom: 1.4, // STARTING VALUE — tune by eye
    portraitZBias: 2, // STARTING VALUE — tune by eye (world units, aspect < 1 only)
    maxAspectGrow: 2.0, // STARTING VALUE — tune by eye
  },

  character: {
    modelScale: 1,
    modelYRotationOffset: 0, // radians, added on top of the movement-facing rotation
    headHeight: 2.3, // STARTING VALUE — tune by eye; shared by the player + every worker (same base model)
    tapHitRadius: 1.4,
    tapHitHeight: 2.6,
    animationMap: {
      idle: 'idle',
      walk: 'walk',
      repair: 'repair',
      yell: 'yell',
      carry: 'carry',
      carryIdle: 'carryIdle',
      walkSlow: 'walkSlow',
      carryWalk: 'carryWalk',
      sitting: 'sitting',
      gaspump: 'gaspump',
      resting: 'resting',
    },
    crossfadeDuration: 0.25, // seconds, used for every state transition
    occlusionHighlight: {
      color: 0x00e5ff, // bright neon cyan-blue silhouette shown through occluders
    },
    workerTint: 0xe07b39, // multiplies worker clone materials so they read as "the mechanic"
    attendantTint: 0x9a5ac9, // purple tint for pump attendants (see scene/GasStationView.js)
    cashierTint: 0x3ad06a, // green tint for the cashier clone (see scene/Cashier.js)
    marketWorkerTint: 0x4a9fd8, // the supermarket worker clone (see scene/MarketWorker.js)
    customerTints: [0xc9956a, 0x6a8fc9, 0xc96a8a, 0x8ac96a, 0xc9b06a, 0x9a6ac9],
    wrenchOffset: {
      scale: 0.4,
      offset: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
  },

  emote: {
    heightAboveHead: 0.6, // world units added on top of character.headHeight
    spriteScale: 0.9, // rough world-unit scale of the emote sprites
  },

  car: {
    modelScale: 1, // the per-tier glbs already bake their own ~0.01 scale; don't re-scale
    modelYRotationOffset: Math.PI, // ≈3.14 rad — cars now drive -z (door→pit); flip ±π if reversed
    engineSmokeOffset: { x: 0, y: 0.7, z: -2.0 }, // engine bay: at the grille, sitting on the hood surface
    hoodSmokeOffset: { x: 0, y: 0.8, z: -1.6 }, // hood surface: front, ahead of the windshield
  },

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

  repair: {
    ticksPerPart: 12.5, // 3-damage car → 37.5 ticks
    tapTicks: 5, // ticks added per manual repair tap (≈ a worker's base rate)
  },

  spawn: {
    interval: 1, // seconds between spawns — paces the whole repair economy
    maxQueuePerPit: 10, // max cars waiting per pit's own queue
    basePayoutPerPart: 20, // payout = basePayoutPerPart × numParts (3-damage car = $60); 8 × 2.5 progression-pacing raise
  },

  upgrades: {
    expandRoom: {
      baseCost: 900,
      costGrowth: 1.6,
    },
    pitEquipment: {
      baseCost: 450,
      costGrowth: 1.6,
    },
    mechanic: {
      baseCost: 180,
      costGrowth: 1.5,
    },
    workerSpeed: {
      baseCost: 150,
      costGrowth: 1.6,
      maxLevel: 8,
      baseRate: 5 / 1.5, // ticks/sec at level 0 → a 37.5-tick car takes ~11.25s
      ratePerLevel: 2.5 / 1.5, // +ticks/sec per level
    },
    fixingTime: {
      baseCost: 225,
      costGrowth: 1.5,
      maxLevel: 5,
      factorPerLevel: 0.15, // each level: factor -0.15 (37.5-tick car → ~32, ~26, ...)
      factorFloor: 0.4, // factor never drops below this
    },
    cashier: {
      baseCost: 1500,
    },
    truckFrequency: {
      baseCost: 450,
      costGrowth: 1.6,
    },
    breakDuration: {
      maxLevel: 2,
      carMechanic: { baseCost: 1000, costGrowth: 1.8 },
      marketWorker: { baseCost: 800, costGrowth: 1.8 },
      gasAttendant: { baseCost: 5000, costGrowth: 1.8 },
    },
    breakThreshold: {
      // each level doubles the jobs-before-break threshold: 50 → 100 → 200
      maxLevel: 2,
      carMechanic: { baseCost: 1000, costGrowth: 1.8 },
      marketWorker: { baseCost: 800, costGrowth: 1.8 },
      gasAttendant: { baseCost: 5000, costGrowth: 1.8 },
    },
    playerSpeed: {
      baseCost: 2000,
      multiplier: 1.3,
    },
    gas: {
      expand: {
        baseCost: 6000,
        costGrowth: 1.6,
      },
      equipment: {
        baseCost: 3000,
        costGrowth: 1.6,
      },
      attendant: {
        baseCost: 1200,
        costGrowth: 1.5,
      },
      workerSpeed: {
        baseCost: 750,
        costGrowth: 1.6,
        maxLevel: 8,
        baseRate: 5 / 1.5, // mirrors the pit workerSpeed
        ratePerLevel: 2.5 / 1.5,
      },
    },
  },

  hurry: {
    duration: 1.2, // seconds
    multiplier: 2.5,
  },

  reputation: {
    baseReputation: 0.05, // starting/permanent reputation at game start
    repStep: 0.05,
    repCap: 1.0,
    adBaseCost: 120,
    adGrowth: 1.5,
    adRewardStep: 0.05, // +5% permanent reputation per rewarded-ad view
    adCooldownSeconds: 1800, // 30-minute cooldown between Watch Ad uses
  },

  cashier: {
    x: -47.0,
    z: 8.5,
    rotation: Math.PI,
  },

  persistence: {
    autoSaveInterval: 5, // seconds between auto-saves, on top of after-purchase saves
  },

  offline: {
    maxHours: 24, // cap how much elapsed time counts, so a long-idle save doesn't grant a huge lump sum
    minSeconds: 60, // ignore anything shorter — avoids a trivial popup on a quick refresh/reload
    efficiency: 0.6, // fudge factor below the theoretical max rate — breaks/empty queues aren't modeled
    drainDuration: 3, // seconds the granted amount takes to drain into the main balance
    popupSeconds: 3, // the "While you were away" popup holds fully visible this long...
    popupFadeSeconds: 0.4, // ...then fades out over this long before removing itself (scene/Hud.js)
  },

  unlockMarkers: {
    radius: 1.0, // ground circle radius (world units)
    labelHeight: 1.6, // cost label height above the circle
    hireOffset: { x: 2.1, z: -3.2 },
    expandOffset: { x: -1.8, z: 0 },
    gasEntryInset: 1.7,
    gasEntryLabelHeight: 2.8,
    interactRadius: 1.8, // proximity range that pays a marker down, mirrors supermarket.interactRadius
    startDelay: 1, // seconds standing in a marker before the drain starts (each entry)
    unlockDuration: 5, // seconds of standing in a marker to complete ANY unlock
    billInterval: 0.08, // seconds between cosmetic bill flights while draining
    billFlyDuration: 0.15, // seconds for one bill's flight from player to marker
    wedgeColor: 0x1b7a3d,
  },

  tutorial: {
    repairCount: 25, // COMPLETED manual repairs step 1 counts down (one rep = one finished car, not one tap)
    finalePopupSeconds: 8, // the closing popup auto-dismisses after this long (or on tap)
    ledProximity: 4, // world-unit range that completes the "walk over to the LED" steps (break/truck panels)
    arrow: {
      size: 44, // arrow glyph font size (px)
      edgeMargin: 56, // px inset from the viewport edges the arrow clamps to
      buttonGap: 46, // px below the Upgrades handle the open-the-tablet arrow floats
    },
    ring: {
      radius: 1.5, // glow ring outer radius (world units) — comfortably wraps a marker circle / car spot
      thickness: 0.32, // radial width of the ring band
      color: 0xffe08a, // matches colors.pitGlow / the label yellow, the game's "look here" tint
      pulseSpeed: 3.2, // radians/sec of the pulse oscillation
      pulseScale: 0.1, // ± fraction of scale swing per pulse
    },
    labelHeight: 2.8, // world-space height the instruction bubble anchors above a world target
    bubblePlayerClearance: 12, // STARTING VALUE — tune by eye (px)
  },

  money: {
    cashPerBill: 15, // pending dollars represented by each visible bill at a pit
    maxBills: 40, // cap on bills shown stacked at one pit
    billSpacing: 0.05, // y gap between stacked bills
    billScale: 0.5, // scale Money.glb down to fit scene
    flyDuration: 0.4, // seconds for bills to fly to the player on collection
    cashTintColor: 0x5fd98b, // multiplies Money.glb materials so the stacks read green (see scene/PitMoney.js)
  },

  storage: {
    shelfCapacity: 10, // max boxes a shelf holds (starts full)
    maxTiresPerPit: 25, // a pit's tire stack caps here (one box worth; each repair burns one tire — a box lasts ~2 minutes)
    autoRestockBaseCost: 1500, // one-time, garage-wide mechanic auto-restock upgrade
    pickupRadius: 1.9, // how close to a shelf the player must stand to grab a box
    shelfOffset: { x: 3.2, z: -13.5 }, // exit-door (front wall) side of the pit, clear of the exit lane
    tireOffset: { x: 2.9, z: 0.2 }, // beside the worker (mechanic.offsetX ≈ 2.1)
    shelfBoxScale: 0.9,
    boxGrid: { cols: 3, spacingX: 0.5, spacingY: 0.5, baseY: 0.35 },
    carriedBoxOffset: { forward: 0.9, y: 1.3 }, // floats ahead of + above the player
    boxHandOffset: { x: 0, y: 0, z: 0 },
    boxHandRotation: { x: 0, y: 0, z: 0},
    shelfScale: 1,
    boxScale: 1, // carried box at full (original) scale
    tireScale: 1,

    garageShelfCollisionHalf: { x: 1.03, z: 0.41 },
    tireCollisionHalf: { x: 0.6, z: 0.4 },
  },

  supermarket: {
    unlockBaseCost: 2400,
    workerHireCost: 750, // Hire Market Worker (workerLevel 0 -> 1)
    workerTrainCost: 1350, // Train Market Worker (workerLevel 1 -> 2)

    cashRegisterScale: 2.5,
    cashRegisterRotation: Math.PI,
    cashRegisterPosition: { x: -47, y: 0, z: 6.9 },
    cashRegisterCollisionHalf: { x: 0.8, z: 0.5 },

    shelfCapacity: 20, // max units per product, per shelf; starts full once unlocked

    products: {
      A: { price: 8, label: 'Fruit' },
      B: { price: 6, label: 'Bakery' },
      C: { price: 11, label: 'Veg' },
      D: { price: 15, label: 'Dairy' },
    },

    customerSpawnInterval: 5, // seconds between spawns, once unlocked
    maxCustomerQueue: 6, // cap on customers in the building at once (waiting + being served)
    customerMinItems: 1,
    customerMaxItems: 5,
    customerMoveSpeed: 3.0, // world units/second
    workerMoveSpeed: 3.4, // world units/second, market worker only
    arriveEpsilon: 0.05, // distance under which a mover counts as "arrived"

    marketX: -38, // entry door's x, clear of every pit lot
    marketExitX: -44, // exit door's x — same (back) wall as entry, to its left; lines up near the checkout
    customerCorridorLength: 4,

    deliveryDoorX: -38, // restock TRUCK's gate in the FRONT wall (z = -halfZ), in the aisle between the shelf clusters
    deliveryCorridorLength: 3,
    shelves: [
      { x: -41, z: -9, productType: 'A', model: 'shelfEnd', offset: { x: 0, z: 0 } },
      { x: -35, z: -9, productType: 'B', model: 'shelfEnd', offset: { x: 0, z: 0 } },
      { x: -45, z: -9, productType: 'C', model: 'freezer', offset: { x: 0, z: 0 } },
      { x: -31, z: -9, productType: 'D', model: 'freezer', offset: { x: 0, z: 0 } },
    ],
    restockBoxPosition: { x: -45, z: -14.5 },

    restockBox: {
      maxUnits: 4,
    },

    truck: {
      deliveryTimes: [300, 240, 180, 120], // seconds from order to arrival, index = truckUpgradeLevel (0..3)
      deliverOffset: { x: 0, z: -3.5 }, // where the truck stops: just beyond the dock box (box.z - 3.5 ≈ -19)
      startOffset: { x: 0, z: -25.5 }, // off-screen start/end point down the front road it drives in from / out to
      waitDuration: 1.5, // seconds paused at the gate before driving back out
      driveDuration: 1.6, // seconds for the drive-in / drive-out tween (mirrors a car's, slower)
      modelScale: 1, // Truck.glb size fixup — tune by eye once visible
      modelYRotationOffset: 0, // facing fixup (radians); flip ±π if it drives backwards
      display: {
        ledColor: '#2eff62', // lit LED pixels (green, vs the break panels' red)
        ledOffColor: '#06300f', // unlit pixels of the dot grid
      },
    },
    checkoutPosition: { x: -44.5, z: 7.596 },
    customerCheckoutSpot: { x: -44.5, z: 9.096 },
    workerCheckoutOffset: { x: 1.5, z: 0 },
    workerIdleSpot: { x: -38, z: -2 },
    hireWorkerMarkerSpot: { x: -35, z: 2 },
    queueAnchor: { x: -42.1, z: 7.6 },
    queueStep: { x: 1.4, z: 0 }, // each further-back slot steps this much further east, toward the entry door

    interactRadius: 1.8, // tap-affordance radius for shelves/checkout/restock pile (mirrors settings.pit.radius)

    floorTileSize: 2,

    shelfCollisionHalf: { x: 1.5, z: 0.6 },
    freezerCollisionHalf: { x: 1.5, z: 0.6 },
    checkoutCollisionHalf: { x: 1.0, z: 0.3 },
    shelfCollisionOffset: { x: 0, z: 0 },
    freezerCollisionOffset: { x: 0, z: 0 },

    shelfScale: 2.5,
    freezerScale: 2.5,
    bagScale: 1,
    restockPileScale: 0.6,
    bagHandOffset: { x: 0, y: 0, z: 0 },
    bagHandRotation: { x: 0, y: 0, z: 15 },
  },

  models: {
    shelf: 'shelf.glb',
    box: 'singlecardboardbox.glb',
    tires: 'Tires.glb',
    shelfEnd: 'shelf_end.glb',
    freezer: 'freezers_standing.glb',
    bag: 'Bag.glb',
    truck: 'Truck.glb',
    cashRegister: 'cash-register.glb',
    gasPump: 'gas_pump.glb',
    wrench: 'wrench.glb',
  },

  pit: {
    radius: 2.4,
    unlockReputation: [0, 0.1, 0.3, 0.5, 0.7],
    driveDuration: 0.7, // seconds for any car drive tween (in/advance/out)
    spotDepth: 4.4, // car-spot depth (z) at each pit — the lane stripes leave a gap this long there
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

  mechanic: {
    offsetX: 2.1,
    offsetZ: 0.2,
    facingOffset: 0, // radians, added on top of the atan2 facing calc — flip 180° if facing is wrong
  },

  gasStation: {
    radius: 2.4,
    driveDuration: 0.7, // seconds for any car drive tween (in/advance/out), mirrors pit
    spotDepth: 4.4, // car-spot depth (z) at each pump — the road stripes leave a gap this long there (mirrors pit)
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
    pumpOffset: { x: 2, z: 1.1 },
    pumpModelScale: 1.5,
    pumpModelYOffset: 0.6435 * 1.5,
    pumpYRotation: Math.PI / 2,
    pumpTintColor: 0xd03a2a,
    pumpCollisionHalf: { x: 0.6, z: 0.5 },
    gateZ: 4,
    fill: {
      baseTicks: 20, // mirrors repair.ticksPerPart's scale
      basePayout: 48, // 19.2 × 2.5 (progression-pacing raise, mirrors spawn.basePayoutPerPart)
    },
    spawn: {
      interval: 1, // seconds between spawns, mirrors settings.spawn.interval
      maxQueuePerPump: 10,
    },
  },

  pitLane: {
    halfWidth: 1.2, // lane half-extent in x — the invisible walls' faces; just covers a parked car
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
    spine: {
      spurOffsetX: 4.8, // spur centre x relative to its pump — the garage (+x) side of its lane, past the break spot, short of the next lane
      spurWidth: 1.8, // spur deck width (x); also the gap in the spine's pump-side railing
      spurLength: 1.2, // horizontal run (z) of a spur's descent — short and steep (stair-like), so the mouth clears the break-spot walk
      endPad: 0.3, // the spine deck continues this far past an end junction before its closing rail
    },
  },

  attendant: {
    offsetX: 2.1,
    offsetZ: 0.2,
    facingOffset: 0,
  },

  breakThresholds: {
    carMechanic: 50,
    marketWorker: 50,
    gasAttendant: 50, // one job = one filled car
    pitAFirstBreak: 5,
  },

  breakDurations: {
    base: 300, // 5 min
    pitAFirstBreak: 30,
  },

  breaks: {
    breakSpotOffset: { x: 5.2, z: -13.0 },
    breakSpotFacing: 0, // radians the resting mechanic faces at its spot
    pumpBreakSpotOffset: { x: 3.4, z: -1.5 },
    marketBreakSpot: { x: -47, z: -3 },
    marketBreakSpotFacing: 1.5,
    mechanicWalkSpeed: 3,
    leanOffset: { side: 0, forward: 0, lift: 0 },
    display: {
      width: 1.6, // panel world width
      height: 0.55, // panel world height
      y: 2.35, // panel centre height on the wall (wall top = world.wallHeight = 3)
      wallInset: 0.06, // stand-off from the wall's inner face (avoids z-fighting)
      poleY: 2.2, // pole-mounted (pump) panel centre height
      pumpBack: 0.5, // pole sits this far behind the attendant's spot (out of its lean space)
      frameColor: 0x23272c, // the casing box + pole
      ledColor: '#ff2d1e', // lit LED pixels
      ledOffColor: '#3a0b06', // unlit pixels of the dot grid
      bgColor: '#0a0a0a', // panel face behind the dots
    },
  },

  audio: {
    garageVolume: 0.4,
    gasStationVolume: 0.4,
    marketVolume: 0.4,
    ambienceFadeDuration: 0.75,
    hammerVolume: 0.25,
    moneyVolume: 0.6,
    bagVolume: 0.6,
    doorOpenVolume: 0.5,
    doorCloseVolume: 0.5,
  },

  ui: {
    fontStack: "'Montserrat', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
    narrowBreakpoint: 860, // STARTING VALUE — tune by eye (px)
    narrowCashDrop: 52, // STARTING VALUE — tune by eye (px the cash row drops: tab-row height + margin)
    menuTabBreakpoint: 480, // STARTING VALUE — tune by eye (px)
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
    grass: 0x7d975c, // muted natural lawn green for the exterior ground field (scene/GroundField.js)
    road: 0x4a4a4a, // asphalt outside each gate + the exterior entry/exit roads
    roadLine: 0xf5e642, // yellow divider line between adjacent pit bays
    laneStripe: 0xffffff, // white guide paint on the garage floor + exterior lane dashes
    label: '#ffe08a', // pit/worker label text (CSS color string for the sprite)
    deskWood: 0x6b4a2f,
  },
};

settings.breaks.breakSpots = settings.pit.positions.map((p) => ({
  x: p.x + settings.breaks.breakSpotOffset.x,
  z: p.z + settings.breaks.breakSpotOffset.z,
}));

settings.breaks.pumpBreakSpots = settings.gasStation.positions.map((p) => ({
  x: p.x + settings.breaks.pumpBreakSpotOffset.x,
  z: p.z + settings.breaks.pumpBreakSpotOffset.z,
}));

{
  const xs = settings.gasStation.positions.map((p) => p.x);
  const lane = xs.length > 1 ? Math.abs(xs[1] - xs[0]) : 4.5;
  settings.gasStation.leftLimitX = Math.min(...xs) - lane / 2;
}

settings.pit.pitWallCollisionHalf = {
  x: settings.world.wallThickness / 2,
  z: settings.world.halfZ + settings.world.wallThickness / 2,
};

settings.supermarket.customerDoorZ =
  settings.world.halfZ + settings.world.wallThickness / 2 + settings.supermarket.customerCorridorLength;

{
  const inset = settings.tunnel.spawnInset;
  const mouthZ = settings.supermarket.customerDoorZ + settings.tunnel.mouthGap;
  settings.supermarket.customerEntryOutside = { x: settings.supermarket.marketX, z: mouthZ + inset };
  settings.supermarket.customerExitOutside = { x: settings.supermarket.marketExitX, z: mouthZ + inset };
  settings.supermarket.customerEntryTunnelMouth = { x: settings.supermarket.marketX, z: mouthZ };
  settings.supermarket.customerExitTunnelMouth = { x: settings.supermarket.marketExitX, z: mouthZ };
}

settings.supermarket.deliveryDoorZ =
  -(settings.world.halfZ + settings.world.wallThickness / 2 + settings.supermarket.deliveryCorridorLength);
settings.supermarket.deliveryDoorOutside = {
  x: settings.supermarket.deliveryDoorX,
  z: -(settings.world.halfZ + settings.supermarket.deliveryCorridorLength + 1.5),
};

settings.supermarket.lobbyRightX = settings.pit.positions[0].x - 2.5;

export default settings;
