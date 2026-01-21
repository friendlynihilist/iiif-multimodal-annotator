import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'examples',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'examples/index.html')
      }
    }
  },
  server: {
    open: '/index.html'
  }
});
