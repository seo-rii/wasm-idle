import type { PyodideInterface } from 'pyodide';
import { PYTHON_DEBUG_PREVIEW } from './pythonDebugPreview';

/** Fixed code is reusable; every run still gets its own breakpoint and stepping state. */
export const PYTHON_DEBUG_TRACE = String.raw`
import os as __wasm_idle_debug_os

__wasm_idle_debug_breakpoint_state = __wasm_idle_debug_bridge.state

# Direct compilation uses relative paths; imported modules use absolute paths.
# Capture both identities before user code can change the working directory.
__wasm_idle_debug_source_filenames = {
    __wasm_idle_debug_filename,
    __wasm_idle_debug_os.path.abspath(__wasm_idle_debug_filename),
}
__wasm_idle_debug_breakpoints = set(json.loads(__wasm_idle_debug_breakpoints_json))
__wasm_idle_debug_breakpoint_version = -1
__wasm_idle_debug_pause_on_entry = __wasm_idle_debug_initial_pause
__wasm_idle_debug_step_mode = None
__wasm_idle_debug_next_depth = None
__wasm_idle_debug_step_out_depth = None

def __wasm_idle_debug_refresh_breakpoints():
    global __wasm_idle_debug_breakpoints
    global __wasm_idle_debug_breakpoint_version
    if __wasm_idle_debug_breakpoint_state.version == __wasm_idle_debug_breakpoint_version:
        return
    payload = __wasm_idle_debug_bridge.readBreakpoints(__wasm_idle_debug_breakpoint_version)
    # JavaScript null crosses Pyodide as JsNull rather than Python None.
    if not isinstance(payload, str):
        return
    snapshot = json.loads(payload)
    version = int(snapshot.get("version", -1))
    if version == __wasm_idle_debug_breakpoint_version:
        return
    __wasm_idle_debug_breakpoint_version = version
    __wasm_idle_debug_breakpoints = set(int(line) for line in snapshot.get("lines", []) if int(line) > 0)

def __wasm_idle_debug_depth(frame):
    depth = 0
    current = frame
    while current is not None:
        if current.f_code.co_filename in __wasm_idle_debug_source_filenames:
            depth += 1
        current = current.f_back
    return depth

${PYTHON_DEBUG_PREVIEW}

def __wasm_idle_debug_locals(frame, start=0, count=50):
    locals_preview = []
    index = 0
    for name, value in frame.f_locals.items():
        if name == "__builtins__" or name.startswith("__wasm_idle_") or name.startswith("."):
            continue
        if index >= start:
            preview = __wasm_idle_debug_preview(value)
            if len(preview) > 200:
                preview = preview[:197] + "..."
            suffix = "… [" + str(index) + "]"
            display_name = name if len(name) <= 256 else name[:256-len(suffix)] + suffix
            locals_preview.append({"name": display_name, "value": preview})
            if len(locals_preview) >= count:
                break
        index += 1
    return locals_preview

def __wasm_idle_debug_stack(frame):
    stack = []
    current = frame
    while current is not None:
        if current.f_code.co_filename in __wasm_idle_debug_source_filenames:
            stack.append({"functionName": current.f_code.co_name, "line": current.f_lineno})
        current = current.f_back
    return stack

def __wasm_idle_debug_trace(frame, event, arg):
    global __wasm_idle_debug_pause_on_entry
    global __wasm_idle_debug_step_mode
    global __wasm_idle_debug_next_depth
    global __wasm_idle_debug_step_out_depth

    if frame.f_code.co_filename not in __wasm_idle_debug_source_filenames:
        return None
    if event != "line":
        return __wasm_idle_debug_trace

    # Poll atomically on every user line, but enter the snapshot helper only on change.
    if __wasm_idle_debug_breakpoint_state.version != __wasm_idle_debug_breakpoint_version:
        __wasm_idle_debug_refresh_breakpoints()
    # Returning from a trace callback executes this event; a later event on the same
    # line is another loop iteration, not a replay of the previous stop.
    needs_depth = __wasm_idle_debug_step_mode in ("next", "out")
    depth = __wasm_idle_debug_depth(frame) if needs_depth else None
    line = frame.f_lineno

    reason = None
    if __wasm_idle_debug_pause_on_entry:
        reason = "entry"
    elif line in __wasm_idle_debug_breakpoints:
        reason = "breakpoint"
    elif __wasm_idle_debug_step_mode == "step":
        reason = "step"
    elif __wasm_idle_debug_step_mode == "next" and __wasm_idle_debug_next_depth is not None and depth <= __wasm_idle_debug_next_depth:
        reason = "nextLine"
    elif __wasm_idle_debug_step_mode == "out" and __wasm_idle_debug_step_out_depth is not None and depth <= __wasm_idle_debug_step_out_depth:
        reason = "stepOut"

    if reason is None:
        return __wasm_idle_debug_trace

    if depth is None:
        depth = __wasm_idle_debug_depth(frame)
    __wasm_idle_debug_pause_on_entry = False
    __wasm_idle_debug_step_mode = None
    __wasm_idle_debug_next_depth = None
    __wasm_idle_debug_step_out_depth = None

    sys.stdout.flush()
    sys.stderr.flush()
    pause_reference = __wasm_idle_debug_bridge.pause(line, reason, json.dumps(__wasm_idle_debug_locals(frame)), json.dumps(__wasm_idle_debug_stack(frame)))
    while True:
        command = __wasm_idle_debug_bridge.wait()
        if command < 0:
            raise KeyboardInterrupt()
        if command == 6:
            try:
                request = json.loads(__wasm_idle_debug_bridge.readWatch())
                start = max(0, int(request.get("start", 0)))
                count = max(1, min(50, int(request.get("count", 50))))
                page = __wasm_idle_debug_locals(frame, start, count) if request.get("reference") == pause_reference else []
                __wasm_idle_debug_bridge.writeWatch(json.dumps(page))
            except Exception:
                __wasm_idle_debug_bridge.writeWatch("[]")
            continue
        if command != 5:
            break
        try:
            expression = __wasm_idle_debug_bridge.readWatch()
            result = __wasm_idle_debug_preview(eval(expression, frame.f_globals, frame.f_locals))
        except Exception as error:
            result = "?" if error.__class__.__name__ == "NameError" else "error"
        __wasm_idle_debug_bridge.writeWatch(result)
    if command == 2:
        __wasm_idle_debug_step_mode = "step"
    elif command == 3:
        __wasm_idle_debug_step_mode = "next"
        __wasm_idle_debug_next_depth = depth
    elif command == 4:
        __wasm_idle_debug_step_mode = "out"
        __wasm_idle_debug_step_out_depth = max(0, depth - 1)
    return __wasm_idle_debug_trace

`;

export const PYTHON_DEBUG_FACTORY = String.raw`
def __wasm_idle_compile_debug_helpers(trace_source, image_source):
    import builtins
    import json
    import sys

    compile_source, execute = builtins.compile, builtins.exec
    trace_code = compile_source(trace_source, "<wasm-idle-debug-trace>", "exec", dont_inherit=True)
    image_code = compile_source(image_source, "<wasm-idle-image-hook>", "exec", dont_inherit=True)
    image_scope = globals()

    def make_trace(filename, breakpoints_json, pause_on_entry, bridge):
        # Keep the existing image-hook guard and namespace shared with ordinary runs.
        execute(image_code, image_scope, image_scope)
        scope = {
            "sys": sys, "json": json,
            "__wasm_idle_debug_filename": filename,
            "__wasm_idle_debug_breakpoints_json": breakpoints_json,
            "__wasm_idle_debug_initial_pause": pause_on_entry,
            "__wasm_idle_debug_bridge": bridge,
        }
        execute(trace_code, scope, scope)
        return scope["__wasm_idle_debug_trace"]

    return make_trace

__wasm_idle_compile_debug_helpers
`;

interface PythonDebugBridge {
	state: { readonly version: number };
	readBreakpoints(knownVersion: number): string | null;
	pause(line: number, reason: string, locals: string, stack: string): number;
	wait(): number;
	readWatch(): string;
	writeWatch(value: string): void;
}

/** The worker retains only fixed code; callers destroy each run's returned trace proxy. */
export function createPythonDebugHelpers(runtime: PyodideInterface, imageHook: string) {
	const factory = runtime.runPython(PYTHON_DEBUG_FACTORY);
	let makeTrace: any;
	try {
		makeTrace = factory(PYTHON_DEBUG_TRACE, imageHook);
	} finally {
		factory.destroy();
	}
	let disposed = false;
	return {
		createTrace(
			filename: string,
			breakpoints: string,
			pauseOnEntry: boolean,
			bridge: PythonDebugBridge
		) {
			if (disposed) throw new Error('Python debug helpers are disposed');
			return makeTrace(filename, breakpoints, pauseOnEntry, bridge);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			makeTrace.destroy();
		}
	};
}
