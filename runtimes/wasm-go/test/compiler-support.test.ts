import { describe, expect, it } from 'vitest';

import {
	collectGoFileImports,
	resolveStdlibDependencies
} from '../src/compiler-support.js';
import type { RuntimeStdlibIndex } from '../src/types.js';

describe('compiler support helpers', () => {
	it('collects direct imports from Go source files', () => {
		const imports = collectGoFileImports([
			{
				path: 'main.go',
				contents: `package main

import (
	"fmt"
	alias "net/http"
	_ "unsafe"
)

import "errors"

func main() {
	fmt.Println(http.MethodGet, errors.New("boom"))
}
`
			}
		]);

		expect(imports).toEqual(['errors', 'fmt', 'net/http', 'unsafe']);
	});

	it('resolves transitive stdlib dependencies from the packaged index', () => {
		const stdlibIndex: RuntimeStdlibIndex = {
			format: 'wasm-go-stdlib-index-v1',
			packageCount: 4,
			packages: [
				{
					importPath: 'errors',
					runtimePath: '/sysroot/errors.a',
					imports: []
				},
				{
					importPath: 'fmt',
					runtimePath: '/sysroot/fmt.a',
					imports: ['errors', 'runtime']
				},
				{
					importPath: 'runtime',
					runtimePath: '/sysroot/runtime.a',
					imports: ['unsafe']
				},
				{
					importPath: 'unsafe',
					runtimePath: '/sysroot/unsafe.a',
					imports: []
				}
			]
		};

		expect(resolveStdlibDependencies(stdlibIndex, ['fmt'], 'main')).toEqual([
			{
				importPath: 'errors',
				archivePath: '/sysroot/errors.a'
			},
			{
				importPath: 'fmt',
				archivePath: '/sysroot/fmt.a'
			},
			{
				importPath: 'runtime',
				archivePath: '/sysroot/runtime.a'
			},
			{
				importPath: 'unsafe',
				archivePath: '/sysroot/unsafe.a'
			}
		]);
	});
});
