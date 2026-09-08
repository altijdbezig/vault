import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two environments on purpose. The crypto layer talks to IndexedDB through
// fake-indexeddb on plain node; the UI needs a DOM. Vitest 5 has no
// environmentMatchGlobs any more, so this is split into projects.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'crypto',
          environment: 'node',
          include: ['src/lib/**/*.test.ts'],
          // Key generation is not free; give the crypto suite room to breathe.
          testTimeout: 30_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/{hooks,components,pages}/**/*.test.tsx'],
          setupFiles: ['src/test/setup-jsdom.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
