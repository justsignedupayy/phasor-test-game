/**
 * settings.js — every tunable value lives here (no Three.js imports).
 * Colors are plain hex ints so this file stays framework-agnostic.
 */
export const settings = {
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
    viewSize: 22, // world units visible vertically (smaller = more zoomed in)
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

  tap: {
    tapValue: 13, // work per manual repair tap
  },

  // Automatic spawning + the waiting queue.
  spawn: {
    interval: 3.0, // seconds between spawns
    maxQueue: 4, // cars waiting in the lane (the pit car is separate)
    baseWorkPerPart: 34, // totalWork = baseWorkPerPart × numParts (× fixing-time mult)
    basePayoutPerPart: 5, // payout   = basePayoutPerPart × numParts (3-damage car = $15)
  },

  // Upgrades (progression). Mechanic is a one-time hire; the others are leveled.
  upgrades: {
    mechanic: {
      cost: 60,
    },
    workerSpeed: {
      baseCost: 40,
      costGrowth: 1.6,
      maxLevel: 6,
      baseRate: 16, // mechanic work/sec at level 0
      ratePerLevel: 10, // +work/sec per level
    },
    fixingTime: {
      baseCost: 30,
      costGrowth: 1.5,
      maxLevel: 6,
      workMultPerLevel: 0.12, // each level: repair speed +12% (work-per-car shrinks)
    },
  },

  // Remote "hurry up": a temporary boost to the mechanic's rate.
  hurry: {
    duration: 1.2, // seconds
    multiplier: 2.5,
  },

  // The single repair pit (world position + how close counts as "present").
  pit: {
    x: -4,
    z: -3,
    radius: 3.0,
    driveDuration: 0.7, // seconds for any car drive tween (in/advance/out)
  },

  // Mechanic NPC stands beside the pit (offset from the pit centre, faces the car).
  mechanic: {
    offsetX: 0.2,
    offsetZ: 1.9,
  },

  // Cars appear at the entrance (outside the right gate) and leave past the exit
  // (outside the left gate). The queue lane runs along x between them.
  entrance: { x: 9, z: -3 },
  exit: { x: -12, z: -3 },
  queue: {
    frontX: -1, // slot 0 (nearest the pit)
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
    pit: 0x5a4a36,
    pitGlow: 0xffe08a, // highlight ring when the player can repair
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
