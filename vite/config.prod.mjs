import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    base: './',
    logLevel: 'warn',
    resolve: {
        alias: {
            // '#bridge' -> the real Playgama Bridge wrapper (this is the
            // Playgama bundle). config.youtube.mjs overrides this alias to
            // bridge.off.js for the Bridge-free build.
            '#bridge': fileURLToPath(new URL('../src/platform/bridge.js', import.meta.url)),
        },
    },
    build: {
        // main.js boots with top-level await (Bridge init + storage hydration
        // must land before loadGame). es2022 = TLA support (Chrome 89+/Safari
        // 15+), a strictly older bar than the WebGL2 hardware the game needs.
        target: 'es2022',
        rollupOptions: {
            output: {
                manualChunks: {
                    three: ['three']
                }
            }
        },
        minify: 'terser',
        terserOptions: {
            compress: {
                passes: 2
            },
            mangle: true,
            format: {
                comments: false
            }
        }
    },
    server: {
        port: 8080
    }
});
