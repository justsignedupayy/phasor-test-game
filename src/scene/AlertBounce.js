import * as THREE from 'three';

/**
 * AlertBounce — a red exclamation-mark sprite popped above a worker's head on
 * a remote hurry tap. Persistent per-instance (Mechanic/MarketWorker each own
 * one, exactly like their ZzzEffect): trigger() shows it and starts a fresh
 * settling vertical bounce, or just restarts the bounce if one is already
 * playing/holding. After a short grace period with no new trigger it fades
 * out and hides itself, ready to be triggered again later.
 *
 * The exclamation-mark texture is a module-level singleton, drawn once and
 * shared by every instance — same pattern as ZzzEffect's "Z" texture.
 */

const BOUNCE_AMPLITUDE = 0.22; // world units of vertical bounce amplitude
const BOUNCE_FREQ = 16; // rad/s — oscillation speed of the settling bounce
const BOUNCE_DECAY = 9; // exponential decay rate of the bounce envelope
const BOUNCE_SETTLE = 0.6; // seconds after which the bounce envelope is ~0
const GRACE = 1.2; // seconds an alert holds with no new trigger before fading
const FADE_DURATION = 0.25; // seconds to fade out once the grace timer expires

const FILL = '#ff1f1f';
const STROKE = '#8a0f0f';

let sharedTexture = null;

/** Build (once) a red exclamation mark: rounded stem capsule over a dot. */
function getAlertTexture() {
  if (sharedTexture) return sharedTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  ctx.fillStyle = FILL;
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 4;

  const stemTop = 6, stemBottom = 40, stemHalfW = 7;
  ctx.beginPath();
  ctx.arc(cx, stemTop + stemHalfW, stemHalfW, Math.PI, 0);
  ctx.lineTo(cx + stemHalfW, stemBottom - stemHalfW);
  ctx.arc(cx, stemBottom - stemHalfW, stemHalfW, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, size - 12, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  sharedTexture = new THREE.CanvasTexture(canvas);
  return sharedTexture;
}

export class AlertBounce {
  constructor(scale = 1) {
    const texture = getAlertTexture();
    this.root = new THREE.Group();
    this.root.visible = false;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(scale, scale, 1);
    this.root.add(this.sprite);

    this.bounceT = 0;
    this.grace = 0;
    this.fading = false;
  }

  /** Show (or re-show) the alert and (re)start its settling bounce from the top. */
  trigger() {
    this.root.visible = true;
    this.sprite.material.opacity = 1;
    this.bounceT = 0;
    this.grace = GRACE;
    this.fading = false;
  }

  update(dt) {
    if (!this.root.visible) return;

    this.bounceT += dt;
    const envelope = this.bounceT < BOUNCE_SETTLE
      ? Math.exp(-BOUNCE_DECAY * this.bounceT) * Math.cos(BOUNCE_FREQ * this.bounceT)
      : 0;
    this.sprite.position.y = BOUNCE_AMPLITUDE * envelope;

    if (!this.fading) {
      this.grace -= dt;
      if (this.grace <= 0) this.fading = true;
      return;
    }
    this.sprite.material.opacity = Math.max(0, this.sprite.material.opacity - dt / FADE_DURATION);
    if (this.sprite.material.opacity <= 0) this.root.visible = false;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.sprite.material.dispose();
  }
}
