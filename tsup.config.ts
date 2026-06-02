import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/rules.ts', 'src/rulesets.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  // The legacy engine libs (data/lib/*.js) are loaded at runtime, not bundled.
  // They will be wired in M2 via the module factory pattern.
  external: [],
});
