import Phaser from 'phaser';
import Boot from './scenes/Boot.js';
import GameScene from './scenes/GameScene.js';

const config = {
  type: Phaser.AUTO,
  width: 540,
  height: 960, // portrait 9:16, logical mobile size
  parent: 'gameParent',
  backgroundColor: '#10161d',
  scene: [Boot, GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
});
