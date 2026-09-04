# Golden-master harness

Proves that changing the engine changes no verdict. See
`docs/engine-modernization-plan.md` §5 in the opquast-devtools repository for why it is a
precondition of M3, not an extra.

## Running it

```bash
npm install
npx playwright install chromium

node test/golden/record.mjs --tier S1 --world main --out .golden-out/run1
```

Flags: `--tier S1|S2|S3|S4`, `--world main|isolated`, `--jquery <path>`, `--offset N`, `--limit N`,
`--out <dir>` (relative to `test/golden/`, default a gitignored scratch directory).
`GOLDEN_NO_EVENT_SHIM=1` disables the DOM0 handler instrumentation.

Output is sorted JSONL, so two runs are compared with `diff -r`.

### System dependencies

Chromium needs more shared libraries than a bare Debian image carries, and the failure is
**silent**: `headless_shell` does not check them and simply dies mid-page — "Target page, context or
browser has been closed" — while the full build refuses to start and names what is missing. Missing
Cairo/Pango cost an hour of bisection here, crashing on any page containing a form control and only
those.

```bash
sudo npx playwright install-deps chromium
```

CI uses `mcr.microsoft.com/playwright`, which carries them; that is the main reason the
authoritative baseline is produced there and not on a workstation.

## Tiers

| tier | content | cases |
|---|---|---|
| S1 | every rule that is not plain DOM matching (not `xpath@html`, not `oqs@html`) | 297 over 118 rules |
| S2 | all of `fixtures/rules/` — 949/949 rules | 2 388 |
| S3 | all of `fixtures/sets/` — chaining, `results_list`, `na` | 3 757 |
| S4 | the periphery: stock, debug, impossible. Recorded, never blocking | 2 322 |

S1 starts with the hard set on purpose. The 822 DOM-only rules are the most deterministic by
construction, so proving them stable would prove little; if the 127 that read stylesheets, scripts,
HTTP resources, feeds or the doctype hold still, the rest follow.

`zombies` is excluded outright: its 23 criteria exist in no ruleset file, so nothing can evaluate
them.

## The two worlds

`--world main` runs the engine in the page's own global; `--world isolated` runs it in a real
isolated world sharing the DOM (CDP `Page.createIsolatedWorld`). Both go through
`Runtime.evaluate`, never `page.evaluate`, so the world is the only difference between two runs.

**They do not agree, and the difference is a production defect, not a harness artifact.**

Measured on S1: 9 of 297 cases differ, all in the `oqs@js` family. `_detectFunction` resolves an
inline handler's call by name against `window` and inspects the function's source:

```js
var fn = window;
for (var i of _function.split('.')) { fn = fn[i]; }
if (reg.test(fn.toString())) { result.push(_function); }
```

In the main world `window.bla` is the page's function and the rule fires. In an isolated world it
is `undefined`, `fn.toString()` throws, and an empty `catch` swallows it — the rule reports nothing.

The legacy add-on used `Cu.Sandbox({ sandboxPrototype: window })`, whose reads fell through to the
page, so it behaved like the main world. The extension injects the engine with
`browser.scripting.executeScript` and no `world` option — that is, isolated. So this family of
rules silently under-detects in production, and the extension's own harnesses cannot see it because
they run in the main world.

Tracked separately: it is an extension defect, not an engine one.

## What the baseline stores

Two levels. Level 1 is one compact line per case:

```
{"k":"rules/IMG_W_ALT/true/1.html#IMG_W_ALT","r":"c","rl":["c"],"n":2,"d":"a3f1…","x":"c","in":"7bd0…"}
```

`r` result · `rl` results_list · `n` number of details · `d` fingerprint of the details · `x` the
hand-written expectation · `in` a hash of the inputs. Level 2 holds the full normalised `details`,
read only when `d` moves. Measured: 24 kB for 297 cases, about 494 kB for the whole net.

`time` is dropped at the source and the fixture server's random port is scrubbed, because neither
is behaviour. Object keys are sorted; **the order of the details array is not** — it follows
document order, which is behaviour.

`in` exists to separate "the engine changed its mind" from "the inputs changed": a case whose
inputs moved is reported as such rather than as a regression.

## Two signals, never mixed

The fixtures carry expectations written by hand years ago — the `true`/`false` directory for the
rules families, the `X-results` meta for the sets families. They are not recordings of the engine
and nothing proves the suite was ever green.

So: the baseline (what the engine does) is one thing, `x` (what the author expected) is another.
The blocking gate compares runs to the baseline and has no opinion on correctness. A separate,
informative pass compares the baseline to `x` and produces a reviewed register of disagreements.
When the engine contradicts the fixture, we record it; we do not quietly fix either side.
