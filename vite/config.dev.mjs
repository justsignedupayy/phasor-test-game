import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    base: './',
    resolve: {
        alias: {
            // The one swappable platform seam: '#bridge' is the real Playgama
            // Bridge wrapper here and in config.prod.mjs; config.youtube.mjs
            // points it at bridge.off.js instead (Bridge-free bundle).
            '#bridge': fileURLToPath(new URL('../src/platform/bridge.js', import.meta.url)),
        },
    },
    build: {
        target: 'es2022', // top-level await in main.js (see config.prod.mjs)
        rollupOptions: {
            output: {
                manualChunks: {
                    three: ['three']
                }
            }
        },
    },
    server: {
        port: 8080
    }
});
