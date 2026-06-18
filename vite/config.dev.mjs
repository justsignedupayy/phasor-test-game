import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
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
