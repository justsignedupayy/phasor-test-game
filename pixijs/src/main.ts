import { Application, Sprite } from "pixi.js";

import FontFaceObserver from "fontfaceobserver";
import { assetManager } from "./core/assets/assetManager";
import { loadGameState } from "./gamestate/save";

async function main() {
  // Create a new PixiJS Application, sized to the whole page.
  const app = new Application();
  await app.init({
    canvas: document.querySelector("#app") as HTMLCanvasElement,
    autoDensity: true,
    resizeTo: window,
    powerPreference: "high-performance",
    backgroundColor: 0x23272a,
  });

  // Example of loading imported assets for ad test buttons.
  const interstitialCube = new Sprite(assetManager.load("/assets/sprites/cube.png"));
  interstitialCube.x = 0;
  interstitialCube.eventMode = 'static';
  interstitialCube.on('pointerup', async () => {
      await requestInterstitialAd();
  });
  app.stage.addChild(interstitialCube);

  const rewardedCube = new Sprite(assetManager.load("/assets/sprites/cube.png"));
  rewardedCube.x = 150;
  rewardedCube.eventMode = 'static';
  rewardedCube.on('pointerup', async () => {
      await requestRewardedAd();
  });
  app.stage.addChild(rewardedCube);

  // Do other setup work here, if needed. Then,
  // tell the SDK that the game is ready to be played.
  ytgame.game.gameReady();

  async function requestInterstitialAd() {
    try {
      await ytgame.ads.requestInterstitialAd();
      console.debug("Interstitial ad requested successfully.");
    } catch (error) {
      console.warn("Failed to request interstitial ad:", error);
    }
  }

  async function requestRewardedAd() {
    try {
      const isRewardEarned = await ytgame.ads.requestRewardedAd(
        "21403813-2e22-4316-a8b2-7d4f52a6f6fb"
      );
      console.debug(`Reward earned: ${isRewardEarned}`);
    } catch (error) {
      console.warn("Failed to request rewarded ad:", error);
    }
  }

  // Play music, for fun.
  const backgroundSound = assetManager.load("/assets/sounds/moonlight.mp3");
  backgroundSound.play();
}

async function bootstrap() {
  // Wait for the the page itself to load
  await Promise.all([
    // Example font loading
    new FontFaceObserver("Pixelify Sans").load(),
    // Wait for the page itself to load.
    new Promise((resolve) => {
      window.addEventListener("DOMContentLoaded", resolve);
    }),
    loadGameState(),
  ]);
  // Tell the SDK that we can render something. Useful if you want to show a loading bar.
  ytgame.game.firstFrameReady();

  // Loads all asset files. You may choose to implement a loading bar
  await assetManager.importAssetFiles();

  main();
}

bootstrap();
