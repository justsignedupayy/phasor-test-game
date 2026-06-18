import Phaser from 'phaser';
import Bridge from '../bridge/Bridge.js';

/**
 * Boot — platform init only. Initializes Playgama Bridge, then hands straight
 * off to the game (no menu, no preload — this slice uses placeholder graphics).
 */
export default class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  async create() {
    await Bridge.init();
    this.scene.start('Game');
  }
}
