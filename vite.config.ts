import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // IFCLoader may import with or without ".js" → alias both
      'three/examples/jsm/utils/BufferGeometryUtils':
        path.resolve(__dirname, 'src/shims/BufferGeometryUtils.ts'),
      'three/examples/jsm/utils/BufferGeometryUtils.js':
        path.resolve(__dirname, 'src/shims/BufferGeometryUtils.ts'),
    },
  },
});
