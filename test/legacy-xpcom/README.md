# The Firefox add-on test harness

Kept, not run. These files drove the fixtures under the Add-on SDK and cannot execute anywhere
today: `tools.js` reads the fixtures out of the **installed XPI** through `nsIZipReader`, `httpd.js`
is Mozilla's XPCOM HTTP server, `frame-script.js` is an e10s frame script, and `test-rules.js` /
`test-sets.js` are Add-on SDK test modules.

They are archived here rather than deleted for one reason that matters and one that is convenient.

**`tools.js` is the executable specification of the fixture contract.** `getHarObject`, the MIME
table, the `<path>.headers` sidecar, the `_all.json` / `<page>.json` / `"*"` override rules — the
port in `test/golden/lib/` was written by reading it, line by line. Keeping it beside the port is
what makes the port auditable: a disagreement about what a fixture means can be settled by reading
the original rather than by argument.

The Python 2 scripts are the other half of that. They never ran the tests; they filed the fixtures.
`stock.py` moved a criterion's fixtures aside when its checklist was retired, `zombies.py` moved
them when the criterion disappeared from the referential altogether, `duplicates.py` found repeats.
They are why `sets-stock/` and `zombies/` exist and what those names mean.

Also recoverable from git, and used the same way when the port was written:

```
git show 438f133a:frame-script.js        # the sandbox: load order, globals, the XHR wrapper
git show 438f133a:test-runner.js         # what the add-on handed the engine
git show 438f133a:utils/har-tools.jsm    # har2res
git show 438f133a:utils/extras.jsm       # extractEvents, dnsLookup, the real xhr
```

Total: about 160 kB. Deleting it would save nothing and cost the only primary source for what the
engine's inputs are supposed to be.
