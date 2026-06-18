import Phaser from 'phaser';
import { createInitialState } from '../core/GameState.js';
import { tick, tapBay, EventType } from '../core/simulation.js';
import Bridge from '../bridge/Bridge.js';

/**
 * GameScene — pure presentation. It owns ZERO game logic:
 *   - reads from GameState every frame to render (cash, car progress)
 *   - forwards taps into the core via tapBay()
 *   - drives time via tick() (no-op until mechanics exist)
 *   - reacts to core events for transient effects (heal pops, slide off, +$)
 */

const CAR_W = 240;
const CAR_H = 130;

const COLOR_BROKEN = new Phaser.Display.Color(192, 57, 43); // red
const COLOR_FIXED = new Phaser.Display.Color(39, 174, 96); // green

// Where each damage marker sits relative to the car's center.
const MARKER_POS = {
  tire: { x: -CAR_W / 2 + 45, y: CAR_H / 2 },
  smoke: { x: 0, y: -CAR_H / 2 - 8 },
  dent: { x: CAR_W / 2 - 52, y: -8 },
};

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    const { width, height } = this.scale;
    this.cx = width / 2;
    this.bayY = height * 0.58;

    // The scene holds only a reference to the state, never logic.
    this.state = createInitialState();

    // Per-bay visual views, keyed by bay id.
    this.bayViews = new Map();

    this.buildHud();
    this.buildBayBackdrop();

    for (const bay of this.state.bays) {
      this.bayViews.set(bay.id, this.createCarView(bay, bay.car, this.cx));
    }

    Bridge.gameReady();
  }

  buildHud() {
    this.cashText = this.add
      .text(this.cx, 78, '$0', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '76px',
        color: '#3ad06a',
        stroke: '#06310f',
        strokeThickness: 9,
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.add
      .text(this.cx, 148, 'G A R A G E', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#7d8a99',
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  buildBayBackdrop() {
    const { width } = this.scale;
    // Bay floor.
    this.add
      .rectangle(this.cx, this.bayY + CAR_H / 2 + 24, width - 60, 10, 0x2a3340)
      .setDepth(0);
    // "Tap the car to repair it" hint.
    this.add
      .text(this.cx, this.bayY + CAR_H / 2 + 90, 'tap the car to repair', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#566273',
      })
      .setOrigin(0.5);
  }

  /**
   * Build the visual for a car: a container with the body rect, wheels, and
   * damage markers. `startX` lets a freshly spawned car slide in from off-screen.
   */
  createCarView(bay, car, startX) {
    const container = this.add.container(startX, this.bayY).setDepth(5);

    const body = this.add
      .rectangle(0, 0, CAR_W, CAR_H, COLOR_BROKEN.color)
      .setStrokeStyle(4, 0x0a0a0a)
      .setInteractive({ useHandCursor: true });
    body.on('pointerdown', () => this.handleTap(bay.id));

    const roof = this.add.rectangle(0, -CAR_H / 2 - 22, CAR_W * 0.55, 46, 0x000000, 0.18);
    const wheelL = this.add.circle(-CAR_W / 2 + 45, CAR_H / 2, 28, 0x111111);
    const wheelR = this.add.circle(CAR_W / 2 - 45, CAR_H / 2, 28, 0x111111);

    const markers = {};
    const markerObjs = car.damage.map((d) => {
      const p = MARKER_POS[d.id] || { x: 0, y: 0 };
      const obj = this.add.text(p.x, p.y, d.icon, { fontSize: '46px' }).setOrigin(0.5);
      markers[d.id] = obj;
      return obj;
    });

    // z-order: roof, body, wheels, then markers on top.
    container.add([roof, body, wheelL, wheelR, ...markerObjs]);

    if (startX !== this.cx) {
      this.tweens.add({ targets: container, x: this.cx, duration: 420, ease: 'Back.out' });
    }

    return { container, body, markers, carId: car.id };
  }

  // --- input ---------------------------------------------------------------

  handleTap(bayId) {
    this.processEvents(tapBay(this.state, bayId));
  }

  // --- frame loop ----------------------------------------------------------

  update(time, delta) {
    // Advance the sim (no-op until mechanic.rate > 0) — wired so auto-progress
    // and other systems drop in here later without changing the renderer.
    this.processEvents(tick(this.state, delta / 1000));
    this.render();
  }

  /** Sync persistent visuals (cash, car color) from state every frame. */
  render() {
    this.cashText.setText(`$${this.state.cash}`);

    for (const bay of this.state.bays) {
      const view = this.bayViews.get(bay.id);
      // Skip a bay mid-transition (its view belongs to the car sliding out).
      if (!view || view.carId !== bay.car.id) continue;

      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        COLOR_BROKEN,
        COLOR_FIXED,
        100,
        Math.floor(bay.car.progress * 100)
      );
      view.body.setFillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    }
  }

  // --- reacting to core events --------------------------------------------

  processEvents(events) {
    for (const e of events) {
      if (e.type === EventType.DamageCleared) this.onDamageCleared(e);
      else if (e.type === EventType.CarFixed) this.onCarFixed(e);
      else if (e.type === EventType.CarSpawned) this.onCarSpawned(e);
    }
  }

  onDamageCleared({ bayId, markerId }) {
    const view = this.bayViews.get(bayId);
    const marker = view?.markers[markerId];
    if (!marker) return;
    this.tweens.add({
      targets: marker,
      scale: 1.7,
      alpha: 0,
      duration: 240,
      ease: 'Quad.out',
      onComplete: () => marker.setVisible(false),
    });
  }

  onCarFixed({ bayId, payout }) {
    const view = this.bayViews.get(bayId);
    if (!view) return;

    // Detach: the spawned car gets its own fresh view.
    this.bayViews.delete(bayId);

    // "+$15" popup floating up from the bay.
    const popup = this.add
      .text(this.cx, this.bayY - CAR_H / 2 - 24, `+$${payout}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '50px',
        color: '#ffd23f',
        stroke: '#3a2a00',
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setDepth(20);
    this.tweens.add({
      targets: popup,
      y: popup.y - 100,
      alpha: 0,
      duration: 950,
      ease: 'Quad.out',
      onComplete: () => popup.destroy(),
    });

    // Flash/scale, then slide the fixed car off-screen and destroy it.
    this.tweens.add({
      targets: view.container,
      scale: 1.12,
      duration: 120,
      yoyo: true,
      ease: 'Quad.out',
      onComplete: () => {
        this.tweens.add({
          targets: view.container,
          x: this.scale.width + CAR_W,
          duration: 400,
          ease: 'Back.in',
          onComplete: () => view.container.destroy(),
        });
      },
    });
  }

  onCarSpawned({ bayId, car }) {
    const bay = this.state.bays.find((b) => b.id === bayId);
    if (!bay) return;
    this.bayViews.set(bayId, this.createCarView(bay, car, -CAR_W));
  }
}
