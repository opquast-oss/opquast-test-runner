import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/rules.ts', 'src/rulesets.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    outDir: 'dist',
    // The legacy engine libs (data/lib/*.js) are loaded at runtime, not bundled: the engine is
    // wired to them through globals (see src/loader.ts).
    external: [],
  },
  {
    // A single-file browser global, for consumers that cannot use a module graph — including the
    // golden harness, which evaluates the engine as a page script exactly like it evaluates the
    // legacy libs. Keeping both adapters on the same mechanism is what makes the comparison
    // between them mean anything: the engine is then the only thing that differs.
    entry: { 'opquast-test-runner': 'src/index.ts' },
    format: ['iife'],
    globalName: 'OpquastTestRunner',
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    outDir: 'dist',
  },
]);
