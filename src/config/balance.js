/**
 * balance.js — the single source of truth for every tunable number.
 *
 * Nothing here imports anything else. Tune the whole game from this file.
 */
export const balance = {
  car: {
    totalWork: 100, // work units needed to fully repair a car
    payout: 15, // cash awarded when a car is fixed

    // Visible damage markers, cleared as repair progress passes each threshold
    // (0..1 fraction of totalWork). Order is purely cosmetic.
    damage: [
      { id: 'tire', icon: '🛞', clearAt: 0.33 },
      { id: 'smoke', icon: '💨', clearAt: 0.66 },
      { id: 'dent', icon: '🔧', clearAt: 1.0 },
    ],
  },

  tap: {
    tapValue: 10, // work added per tap (totalWork 100 / 10 = ~10 taps per car)
  },

  mechanic: {
    rate: 0, // auto-repair work per second. 0 for this slice; raise it later.
  },
};

export default balance;
