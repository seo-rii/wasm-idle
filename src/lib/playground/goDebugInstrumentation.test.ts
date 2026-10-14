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

	it('does not place hooks inside multi-line composite literals or type bodies', () => {
		const output = instrumentGoDebugSource(`package main

type P struct {
	X int
}

func main() {
	p := P{
		X: 1,
	}
	items := []P{
		{X: 2},
	}
	type pair struct {
		a, b int
	}
	println(p.X, len(items))
}`);

		expect(output).toContain('__wasmIdleDebugLine(8)');
		expect(output).not.toContain('__wasmIdleDebugLine(9)');
		expect(output).toContain('__wasmIdleDebugLine(11)');
		expect(output).not.toContain('__wasmIdleDebugLine(12)');
		expect(output).toContain('__wasmIdleDebugLine(14)');
		expect(output).not.toContain('__wasmIdleDebugLine(15)');
		expect(output).toContain('__wasmIdleDebugLine(17)');
	});

	it('keeps hooking statement blocks opened by headers and function literals', () => {
		const output = instrumentGoDebugSource(`package main

func main() {
	handlers := map[string]func() int{
		"a": func() int {
			return 1
		},
	}
	for _, v := range []int{1, 2} {
		println(v)
	}
	if v, ok := handlers["a"]; ok {
		println(v())
	} else {
		println(0)
	}
}`);

		expect(output).not.toContain('__wasmIdleDebugLine(5)');
		expect(output).toContain('__wasmIdleDebugLine(6)');
		expect(output).toContain('__wasmIdleDebugLine(10)');
		expect(output).toContain('__wasmIdleDebugLine(13)');
		expect(output).toContain('__wasmIdleDebugLine(15)');
	});

	it('does not place hooks on lines that continue the previous statement', () => {
		const output = instrumentGoDebugSource(`package main

func main() {
	x := 1 +
		2
	if x > 1 &&
		x < 5 {
		println(x)
	}
	println(x,
		x)
outer:
	for {
		break outer
	}
}`);

		expect(output).toContain('__wasmIdleDebugLine(4)');
		expect(output).not.toContain('__wasmIdleDebugLine(5)');
		expect(output).toContain('__wasmIdleDebugLine(6)');
		expect(output).not.toContain('__wasmIdleDebugLine(7)');
		expect(output).toContain('__wasmIdleDebugLine(8)');
		expect(output).toContain('__wasmIdleDebugLine(10)');
		expect(output).not.toContain('__wasmIdleDebugLine(11)');
		expect(output).not.toContain('__wasmIdleDebugLine(13)');
		expect(output).toContain('__wasmIdleDebugLine(14)');
	});

	it('leaves multi-line raw strings untouched and keeps nesting across them', () => {
		const output = instrumentGoDebugSource(`package main

func main() {
	text := \`first
second {
third\`
	println(text)
}

func after() {
	println("after")
}`);

		expect(output).toContain('\ttext := `first\nsecond {\nthird`\n');
		expect(output).toContain('__wasmIdleDebugLine(4)');
		expect(output).toContain('__wasmIdleDebugLine(7)');
		expect(output).toContain('__wasmIdleDebugEnter("after", 10)');
		expect(output).toContain('__wasmIdleDebugLine(11)');
	});
});
