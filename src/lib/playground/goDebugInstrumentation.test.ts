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
		expect(output).toContain('import "fmt"');
		expect(output).toContain('__wasm_idle_debug_json "encoding/json"');
		expect(output).toContain('__wasm_idle_debug_js "syscall/js"');
		expect(output).toContain('__wasmIdleDebugEnter("add", 5)');
		expect(output).toContain('__wasmIdleDebugLine(6)');
		expect(output).toContain('__wasmIdleDebugLine(7)');
		expect(output).toContain('__wasmIdleDebugLine(8)');
		expect(output).not.toMatch(/__wasmIdleDebugEnter\("__wasmIdleDebug/);
	});

	it.each([
		'import ("fmt")',
		'import (\n\t"fmt")',
		'import (f "fmt")',
		'import "fmt"\nimport "strings"',
		'import ("fmt"; "strings") // user imports'
	])('preserves legal import declarations: %s', (imports) => {
		const output = instrumentGoDebugSource(
			`package main\n${imports}\nfunc main() {\n\tprintln("hello")\n}`
		);
		expect(output).toContain(`${imports}\nfunc main()`);
		expect(output.indexOf('__wasm_idle_debug_json "encoding/json"')).toBeLessThan(
			output.indexOf(imports)
		);
		expect(output.indexOf('type __wasmIdleDebugFrame')).toBeGreaterThan(
			output.indexOf('func main()')
		);
	});

	it.each([
		[' /*\npackage documentation\n*/\n', 'import "fmt"'],
		[' /* documentation\r\ncontinued\r\n*/\r\n', 'import ("fmt")'],
		[' /* documentation\n*/ ', 'import (\n\t"fmt"\n)'],
		[' /* first\n*/ /* second\n*/\n', 'import "fmt"\nimport "strings"'],
		[' // package documentation\n', 'import "fmt"'],
		[' // package documentation\r\n', 'import ("fmt"; "strings")'],
		['; ', 'import "fmt"'],
		[' /* package note */; ', 'import ("fmt")']
	])('preserves package trivia %j before imports %j', (trivia, imports) => {
		const output = instrumentGoDebugSource(
			`package main${trivia}${imports}\nfunc main() {\n\tprintln("hello")\n}`
		);

		expect(output).toContain(trivia);
		expect(output).toContain(imports);
	});

	it('finds the actual package clause after a comment containing a package line', () => {
		const comment = '/*\npackage documentation\n*/\n';
		const output = instrumentGoDebugSource(
			`${comment}package main /* package note\n*/\nimport "fmt"\nfunc main() {}`
		);

		expect(output).toContain(comment);
		expect(output.indexOf('__wasm_idle_debug_json "encoding/json"')).toBeGreaterThan(
			output.indexOf('package main')
		);
		expect(output).toContain(' /* package note\n*/\nimport "fmt"');
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

	it('keeps hooks out of multi-line composite literals in loop and switch headers', () => {
		const output = instrumentGoDebugSource(`package main

func main() {
	for _, tc := range []struct {
		name string
	}{
		{"a"},
	} {
		println(tc.name)
	}
	for _, v := range []int{
		1,
	} {
		println(v)
	}
	for _, p := range []*P{
		{X: 1},
	} {
		println(p.X)
	}
	a := []int{3}
	switch a[0] * v {
	case 3:
		println(a)
	}
}`);

		expect(output).toContain('__wasmIdleDebugLine(4)');
		expect(output).not.toContain('__wasmIdleDebugLine(5)');
		expect(output).not.toContain('__wasmIdleDebugLine(7)');
		expect(output).toContain('__wasmIdleDebugLine(9)');
		expect(output).not.toContain('__wasmIdleDebugLine(12)');
		expect(output).toContain('__wasmIdleDebugLine(14)');
		expect(output).not.toContain('__wasmIdleDebugLine(17)');
		expect(output).toContain('__wasmIdleDebugLine(19)');
		expect(output).toContain('__wasmIdleDebugLine(24)');
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

	it('does not insert the entry hook into a raw string opened on the signature line', () => {
		const output = instrumentGoDebugSource(`package main

func usage() { print(\`Usage:
  run {
\`) }

func main() {
	usage()
}`);

		expect(output).toContain('func usage() { print(`Usage:\n  run {\n`) }');
		expect(output).not.toContain('__wasmIdleDebugEnter("usage"');
		expect(output).toContain('__wasmIdleDebugEnter("main", 7)');
		expect(output).toContain('__wasmIdleDebugLine(8)');
	});
});
