import { loadPyodide } from 'pyodide';

// Isolate the unchanged-version bridge cost in the real pinned interpreter.
// This is not an end-to-end execution/debug benchmark.
const runtime = await loadPyodide();
const control = new Int32Array(new SharedArrayBuffer(16));
Atomics.store(control, 2, 7);
runtime.registerJsModule('poll_probe', {
	state: {
		get version() {
			return Atomics.load(control, 2);
		}
	},
	read_breakpoints: (known) =>
		known === Atomics.load(control, 2)
			? null
			: JSON.stringify({ version: Atomics.load(control, 2), lines: [] })
});
console.log(
	runtime.runPython(`
import json, statistics, sys, time
from poll_probe import state, read_breakpoints

def callback(n):
    for _ in range(n):
        payload = read_breakpoints(7)
        if not isinstance(payload, str):
            continue

def prop(n):
    for _ in range(n):
        if state.version == 7:
            continue
        payload = read_breakpoints(7)

results = {"callback": [], "property": []}
for round in range(7):
    order = [("callback", callback), ("property", prop)]
    if round % 2:
        order.reverse()
    for name, function in order:
        start = time.perf_counter()
        function(100000)
        results[name].append((time.perf_counter() - start) * 1000)
json.dumps({"python": sys.version, "checks_per_round": 100000,
    "milliseconds": results,
    "medians_ms": {name: statistics.median(values) for name, values in results.items()}})
`)
);
