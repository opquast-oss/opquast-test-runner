# @opquast/test-runner

Opquast web quality test engine — evaluates rules against a DOM and sidecar data.

## Installation

```bash
npm install @opquast/test-runner
```

## Usage

```typescript
import { createEngine, rules, rulesets } from '@opquast/test-runner';

// The engine requires jQuery and the legacy libs to be loaded first
// (jquery-1.9.1.min.js, oqs-utils.js, cssParser.js, oqs-validator.js, oqs-tests.js)

const engine = createEngine({
  jQuery: window.jQuery,
  logger: console,        // optional
  config: { debug: true } // optional
});

const results = await engine.analyze({
  document: window.document,
  rules,
  rulesets,
  criteria: ['1', '2', '3'], // optional subset
});

// results: Array<{ id, result, comment, details }>
// result values: 'c' (conforme), 'nc' (non-conforme), 'i' (indéterminé), 'na' (non-applicable), 'nt' (non-testé)
```

## API

### `createEngine(options)`

Creates an engine instance.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `jQuery` | `unknown` | Yes | jQuery 1.9+ instance |
| `logger` | `Logger` | No | Logger interface (`log`, `warn`, `error`) |
| `services` | `Services` | No | External services (`xhr`, `dnsResolve`) |
| `config` | `EngineConfig` | No | Config flags (`debug`, `showErrors`) |

### `engine.analyze(options)`

Runs analysis on a document.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `document` | `Document` | Yes | DOM document to analyze |
| `rules` | `Record<string, string>` | Yes | Rules definitions |
| `rulesets` | `Record<string, unknown>` | Yes | Rulesets definitions |
| `criteria` | `string[]` | No | Criterion IDs to evaluate (defaults to all) |
| `sidecar` | `Partial<Sidecar>` | No | Pre-built sidecar data |
| `eventsMode` | `'full' \| 'inline' \| 'none'` | No | Event reconstruction mode |
| `responses` | `Record<string, XhrResponseData>` | No | Pre-fetched HTTP responses |

### Exports

```typescript
// Main API
import { createEngine } from '@opquast/test-runner';

// Data (bundled JSON)
import { rules } from '@opquast/test-runner';
import { rulesets } from '@opquast/test-runner';

// Or via subpath exports
import rules from '@opquast/test-runner/rules';
import rulesets from '@opquast/test-runner/rulesets';

// Utilities
import { buildEventsFromDom, buildSyntheticResource } from '@opquast/test-runner';
```

## License

MPL-2.0 — Temesis SAS
