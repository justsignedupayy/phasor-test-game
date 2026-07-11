import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import prodConfig from './config.prod.mjs';

/**
 * YouTube Playables build — identical to the production build EXCEPT the
 * '#bridge' seam resolves to bridge.off.js, so the Playgama Bridge wrapper
 * (and its CDN script injection) never enters the bundle. ads.js then takes
 * its stub path (instant success) and storage.js keeps its localStorage
 * backend: the shipped bundle makes ZERO external network calls, per
 * YouTube's rules. Output goes to dist-youtube/ so both bundles can coexist.
 */
export default mergeConfig(
    prodConfig,
    defineConfig({
        resolve: {
            alias: {
                '#bridge': fileURLToPath(new URL('../src/platform/bridge.off.js', import.meta.url)),
            },
        },
        build: {
            outDir: 'dist-youtube',
        },
    })
);
