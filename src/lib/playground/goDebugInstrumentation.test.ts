import { describe, expect, it } from 'vitest';

import { instrumentGoDebugSource } from './goDebugInstrumentation';

describe('instrumentGoDebugSource', () => {
	it('adds debug imports and line hooks without instrumenting the debug helpers', () => {
		const output = instrumentGoDebugSource(`package main

import "fmt"

func add(left int, right int) int {
	total := left + right
	fmt.Println(total)
	return total
}`);

		expect(output).toContain('import (');
		expect(output).toContain('\t"fmt"');
		expect(output).toContain('__wasm_idle_debug_json "encoding/json"');
		expect(output).toContain('__wasm_idle_debug_js "syscall/js"');
		expect(output).toContain('__wasmIdleDebugEnter("add", 5)');
		expect(output).toContain('__wasmIdleDebugLine(6)');
		expect(output).toContain('__wasmIdleDebugLine(7)');
		expect(output).toContain('__wasmIdleDebugLine(8)');
		expect(output).not.toMatch(/__wasmIdleDebugEnter\("__wasmIdleDebug/);
	});

	it('creates an import block when the original file has no imports', () => {
		const output = instrumentGoDebugSource(`package main

func main() {
	println("hi")
}`);

		expect(output).toMatch(/package main\s+import \(\s+__wasm_idle_debug_json/s);
		expect(output).toContain('__wasmIdleDebugEnter("main", 3)');
		expect(output).toContain('__wasmIdleDebugLine(4)');
	});

	it('does not place hooks before case labels, defaults, or one-line function bodies', () => {
		const output = instrumentGoDebugSource(`package main

func main() {
	switch value := 1; value {
	case 1:
		println(value)
	default:
		println(0)
	}
}

func done() {}`);

		expect(output).toContain('__wasmIdleDebugLine(4)');
		expect(output).not.toContain('__wasmIdleDebugLine(5)');
		expect(output).toContain('__wasmIdleDebugLine(6)');
		expect(output).not.toContain('__wasmIdleDebugLine(7)');
		expect(output).toContain('__wasmIdleDebugLine(8)');
		expect(output).not.toMatch(/func done\(\) \{\}\n\s+__wasmIdleDebugEnter/);
	});
});
