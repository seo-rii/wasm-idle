import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadPyodide } from 'pyodide';

// Opt-in, single-interpreter measurement. No CI timing threshold and no backend switch.
const root = fileURLToPath(new URL('../', import.meta.url));
const baselineRef = process.argv.find((value) => value.startsWith('--baseline-ref='))?.slice(15);
if (!baselineRef)
	throw new Error('Pass --baseline-ref=<commit containing the inline Python tracer>');
const workerPath = 'src/lib/playground/worker/python.ts';
const baselineWorker = execFileSync('git', ['show', `${baselineRef}:${workerPath}`], {
	cwd: root,
	encoding: 'utf8'
});
const currentWorker = readFileSync(new URL(`../${workerPath}`, import.meta.url), 'utf8');
const ts = createRequire(import.meta.url)('typescript');
const preview = {};
const baselinePreview = {};
const baselinePreviewSource = execFileSync(
	'git',
	['show', `${baselineRef}:src/lib/playground/worker/pythonDebugPreview.ts`],
	{ cwd: root, encoding: 'utf8' }
);
const debug = {};
function load(
	source,
	exports,
	require = () => {
		throw new Error('Unexpected probe import');
	}
) {
	const result = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		reportDiagnostics: true
	});
	assert.equal(result.diagnostics.length, 0);
	vm.runInNewContext(result.outputText, { exports, require });
}
load(
	readFileSync(
		new URL('../src/lib/playground/worker/pythonDebugPreview.ts', import.meta.url),
		'utf8'
	),
	preview
);
load(baselinePreviewSource, baselinePreview);
const debugSource = readFileSync(
	new URL('../src/lib/playground/worker/pythonDebug.ts', import.meta.url),
	'utf8'
);
load(debugSource, debug, (id) => {
	assert.equal(id, './pythonDebugPreview');
	return preview;
});
const start = baselineWorker.indexOf('import os as __wasm_idle_debug_os');
const end = baselineWorker.indexOf('sys.settrace(__wasm_idle_debug_trace)', start);
assert.ok(start >= 0 && end > start, 'Baseline must contain the original inline tracer');
let baseline = baselineWorker.slice(start, end);
for (const [from, to] of Object.entries({
	'${normalizedBreakpoints}': '[]',
	"${pauseOnEntry ? 'True' : 'False'}": 'False',
	'${debugFilenameLiteral}': '"user.py"',
	'${debugPauseName}': 'pause',
	'${debugWaitName}': 'wait',
	'${debugReadWatchName}': 'read_watch',
	'${debugWriteWatchName}': 'write_watch',
	'${debugReadBreakpointsName}': 'read_breakpoints',
	'${PYTHON_DEBUG_PREVIEW}': baselinePreview.PYTHON_DEBUG_PREVIEW
}))
	baseline = baseline.replaceAll(from, to);
assert.ok(!baseline.includes('${'));
const imageHook = currentWorker.split('const imageHook = `', 2)[1].split('`;', 1)[0];
const baselineImageHook = baselineWorker.split('const imageHook = `', 2)[1].split('`;', 1)[0];
const runtime = await loadPyodide();
let versionChecks = 0;
let snapshots = 0;
const bridge = {
	state: {
		get version() {
			versionChecks++;
			return 0;
		}
	},
	readBreakpoints: () => {
		snapshots++;
		return '{"version":0,"lines":[]}';
	},
	pause: () => {
		throw new Error('Unexpected benchmark pause');
	},
	wait: () => 1,
	readWatch: () => '',
	writeWatch: () => {}
};
runtime.registerJsModule('trace_probe', { bridge });
for (const [name, value] of Object.entries({
	baseline_source: baseline,
	current_source: debug.PYTHON_DEBUG_TRACE,
	factory_source: debug.PYTHON_DEBUG_FACTORY,
	image_source: imageHook,
	baseline_image_source: baselineImageHook
}))
	runtime.globals.set(name, value);
try {
	const measurement = JSON.parse(
		runtime.runPython(`
import json, statistics, sys, time
from trace_probe import bridge
factory_namespace = {}
exec(factory_source, factory_namespace)
make_trace = factory_namespace['__wasm_idle_compile_debug_helpers'](current_source, image_source)
base_scope = {'sys': sys, 'json': json, 'pause': bridge.pause, 'wait': bridge.wait,
              'read_watch': bridge.readWatch, 'write_watch': bridge.writeWatch,
              'read_breakpoints': bridge.readBreakpoints, '__wasm_idle_debug_breakpoint_state': bridge.state}
exec(compile(baseline_source, '<baseline-trace>', 'exec'), base_scope)
current = make_trace('user.py', '[]', False, bridge)
def minimal(frame, event, arg):
    return minimal
variants = {'plain': None, 'minimal_settrace': minimal,
            'baseline': base_scope['__wasm_idle_debug_trace'], 'current': current}
iterations, samples = 50000, 7
work = compile('total = 0\\nfor i in range(' + str(iterations) + '):\\n    total += i\\n', 'user.py', 'exec')
def sample(callback):
    scope = {}
    start = time.perf_counter()
    try:
        sys.settrace(callback)
        exec(work, scope)
    finally:
        sys.settrace(None)
    elapsed = (time.perf_counter() - start) * 1000
    assert scope['total'] == iterations * (iterations - 1) // 2
    return elapsed
cold = {name: sample(callback) for name, callback in variants.items()}
results = {name: [] for name in variants}
for round in range(samples):
    order = list(variants)
    if round % 2: order.reverse()
    for name in order: results[name].append(sample(variants[name]))
setup = {'baseline_compile_and_exec': [], 'cached_helper_new_run': []}
setup_source = baseline_image_source + '\\n' + baseline_source
# Both image paths retain their original once-per-worker installation guard.
for round in range(samples):
    order = list(setup)
    if round % 2: order.reverse()
    for name in order:
        start = time.perf_counter()
        for repeat in range(20):
            if name == 'baseline_compile_and_exec':
                exec(compile(setup_source, '<baseline-debug-setup>', 'exec'), base_scope)
            else:
                make_trace('user.py', '[]', False, bridge)
        setup[name].append((time.perf_counter() - start) * 1000 / 20)
monitor = {'available': hasattr(sys, 'monitoring')}
if monitor['available']:
    m = sys.monitoring
    tool = next((i for i in range(6) if m.get_tool(i) is None), None)
    monitor['free_tool'] = tool is not None
    if tool is not None:
        m.use_tool_id(tool, 'wasm-idle-debug-probe')
        program = compile('value = 0\\nwhile value < 3: value += 1\\nfinished = value\\n', 'repeated.py', 'exec')
        trace_events, line_events = [], []
        def trace(frame, event, arg):
            if frame.f_code.co_filename != 'repeated.py': return None
            if event == 'line': trace_events.append(frame.f_lineno)
            return trace
        def line(code, number):
            if code.co_filename == 'repeated.py': line_events.append(number)
        try:
            try:
                sys.settrace(trace)
                exec(program, {})
            finally:
                sys.settrace(None)
            m.register_callback(tool, m.events.LINE, line)
            m.set_events(tool, m.events.LINE)
            exec(program, {})
        finally:
            m.set_events(tool, 0)
            m.register_callback(tool, m.events.LINE, None)
            m.free_tool_id(tool)
        monitor['repeated_line'] = {'settrace': trace_events, 'monitoring_LINE': line_events}
json.dumps({'python': sys.version, 'iterations': iterations, 'samples': samples,
            'warmups_per_variant': 1, 'order': 'alternating forward/reverse',
            'first_run_ms': cold, 'samples_ms': results,
            'medians_ms': {name: statistics.median(values) for name, values in results.items()},
            'setup_repetitions_per_sample': 20, 'setup_per_run_samples_ms': setup,
            'setup_per_run_medians_ms': {name: statistics.median(values) for name, values in setup.items()},
            'monitoring': monitor})
`)
	);
	const sha256 = (value) => createHash('sha256').update(value).digest('hex');
	console.log(
		JSON.stringify(
			{
				node: process.version,
				pyodide: runtime.version,
				baseline_ref: baselineRef,
				source_sha256: {
					baseline_worker: sha256(baselineWorker),
					baseline_preview: sha256(baselinePreviewSource),
					current_worker: sha256(currentWorker),
					current_helper: sha256(debugSource)
				},
				...measurement,
				version_checks: versionChecks,
				snapshots
			},
			null,
			2
		)
	);
} finally {
	runtime.runPython('sys.settrace(None)');
	runtime.unregisterJsModule('trace_probe');
}
