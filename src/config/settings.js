/**
 * settings.js — every tunable value lives here (no Three.js imports).
 * Colors are plain hex ints so this file stays framework-agnostic.
 */
export const settings = {
  // How many parallel pits can ever exist. Pit 0 starts unlocked + equipped.
  maxPits: 4,

  // Garage interior bounds (character is clamped inside these on the x/z plane).
  world: {
    halfX: 7,
    halfZ: 9,
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
    viewSize: 24, // world units visible vertically (smaller = more zoomed in)
    distance: 40, // ortho position scale; does NOT change apparent size
    near: 0.1,
    far: 200,
  },

  // Transform-only character animation.
  bob: {
    idleFreq: 2.2,
    idleAmp: 0.04,
    walkFreq: 9.0,
    walkAmp: 0.12,
    armSwing: 0.5,
  },

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

  // Automatic spawning + the shared waiting queue.
  spawn: {
    interval: 3.0, // seconds between spawns
    maxQueue: 4, // cars waiting in the lane (pit cars are separate)
    basePayoutPerPart: 5, // payout = basePayoutPerPart × numParts (3-damage car = $15)
  },

  // Two-stage room unlock + the per-pit upgrades. All costs are geometric
  // (cost = baseCost × costGrowth^level); see upgrades.js for the level used.
  upgrades: {
    // Stage 1: add empty floor space (reveals the next lot).
    expandRoom: {
      baseCost: 300,
      costGrowth: 1.6,
    },
    // Stage 2: install the repair station on a roomUnlocked lot. Scales by pit index.
    pitEquipment: {
      baseCost: 150,
      costGrowth: 1.6,
    },
    // One-time worker hire per pit (enables auto-repair + remote hurry). Scales by index.
    mechanic: {
      baseCost: 60,
      costGrowth: 1.5,
    },
    // Per-pit worker speed (ticks/sec).
    workerSpeed: {
      baseCost: 50,
      costGrowth: 1.6,
      maxLevel: 8,
      baseRate: 1, // ticks/sec at level 0 → a 15-tick car takes ~15s
      ratePerLevel: 0.5, // +ticks/sec per level
    },
    // Per-pit fixing time: lowers the fix-time factor (≤1), shrinking required ticks.
    fixingTime: {
      baseCost: 75,
      costGrowth: 1.5,
      maxLevel: 5,
      factorPerLevel: 0.15, // each level: factor -0.15 (15-tick car → ~13, ~11, ...)
      factorFloor: 0.4, // factor never drops below this
    },
  },

  // Remote "hurry up": a temporary boost to a worker's rate (per pit).
  hurry: {
    duration: 1.2, // seconds
    multiplier: 2.5,
  },

  // The pits: shared geometry plus a world position per pit. radius = how close
  // the player must stand to manually tap an unmanned pit.
  pit: {
    radius: 1.7,
    driveDuration: 0.7, // seconds for any car drive tween (in/advance/out)
    positions: [
      { x: -5.4, z: 2.0 },
      { x: -1.8, z: 2.0 },
      { x: 1.8, z: 2.0 },
      { x: 5.4, z: 2.0 },
    ],
  },

  // Each worker NPC stands beside its pit (offset from the pit centre, faces the car).
  mechanic: {
    offsetX: 2.1,
    offsetZ: 0.2,
  },

  // Cars appear at the entrance (outside the right gate) and leave past the exit
  // (outside the left gate). The shared queue lane runs along x at z = laneZ.
  laneZ: -3,
  entrance: { x: 9, z: -3 },
  exit: { x: -12, z: -3 },
  queue: {
    frontX: 4.5, // slot 0 (nearest the entrance side, before routing up to a pit)
    frontZ: -3,
    slotDX: 2.4, // each further slot steps this toward the entrance
    slotDZ: 0,
  },

  colors: {
    background: 0x12161c,
    floor: 0x3a4250,
    lane: 0x454e5d, // the queue lane strip
    grid: 0x2a3340,
    wall: 0x4b5563,
    gate: 0x6b7787, // door pillars / lintels
    lot: 0x2f3845, // an empty (roomUnlocked, unequipped) lot patch
    lotEdge: 0x6b7787, // outline of an empty lot
    pit: 0x5a4a36, // an equipped pit station floor
    pitGlow: 0xffe08a, // highlight ring when the player can repair
    toolbox: 0xc0392b, // a small toolbox marking an equipped pit
    label: '#ffe08a', // pit/worker label text (CSS color string for the sprite)
    // player character
    body: 0x2e86de,
    head: 0xf6c177,
    limb: 0x1f5fae,
    accent: 0xffd23f,
    exclaim: 0xff5252, // the "!" yell marker
    // mechanic NPC (distinct colour)
    mechBody: 0xe07b39,
    mechHead: 0xf6c177,
    mechLimb: 0xb5602a,
    spark: 0xffd23f,
    // broken car
    carBody: 0xb0433a,
    carCabin: 0x8c352e,
    carDent: 0x7a2f28,
    wheel: 0x1a1a1a,
    smoke: 0x9aa0a6,
  },
};

export default settings;
