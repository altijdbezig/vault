import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two environments on purpose. The crypto layer talks to IndexedDB through
// fake-indexeddb on plain node; the UI needs a DOM. Vitest 5 has no
// environmentMatchGlobs any more, so this is split into projects.
export default defineConfig({
  // Same injection as vite.config.ts: the About tab reads __APP_VERSION__, and
  // a test that renders it should not fall over on an undefined global.
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    // Vitest schaalt zijn workerpool standaard mee met het aantal CPU's, en
    // elke jsdom-worker kost ongeveer 150 MB. Gemeten op 10-09-2026, op een
    // machine met 16 CPU's:
    //
    //   standaard      1653 MB piek, tot 20 node-processen, 7,0 s
    //   maxWorkers: 4  1286 MB piek,  8 processen,           7,0 s
    //   maxWorkers: 2   946 MB piek,  6 processen,          10,7 s
    //
    // Zonder plafond hangt het geheugengebruik dus af van de machine waarop de
    // build toevallig draait. Een buildcontainer die veel CPU's rapporteert maar
    // een geheugenlimiet heeft, laat de kernel het proces doodschieten — en dan
    // staat er geen gevallen test in de log, want er sluit niets netjes af; de
    // uitvoer stopt gewoon midden in een testbestand.
    //
    // Twee workers kost 3,7 seconden extra en houdt de piek onder de 1 GB. Dat
    // is de afweging waard: dit is een build die op een Hobby-container moet
    // passen. Verhoog dit niet zonder opnieuw te meten.
    maxWorkers: 2,
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
