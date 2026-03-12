import { afterEach, describe, expect, it, vi } from 'vitest';

import Clang from '$lib/clang';

function createClangHarness() {
	const stdout = vi.fn();
	const clang = Object.assign(Object.create(Clang.prototype), {
		ready: Promise.resolve(),
		moduleCache: {},
		stdout,
		showTiming: false,
		log: false,
		debug: false,
		lastBuildKey: '',
		traceStartedAt: 0,
		path: '',
		memfs: {
			addFile: vi.fn(),
			getFileContents: vi.fn(() => new Uint8Array([0x00]))
		},
		getModule: vi.fn(async () => ({ id: 'module' })),
		run: vi.fn(async () => null),
		hostLogAsync: vi.fn(async (_label: string, promise: Promise<any>) => await promise),
		link: vi.fn(async () => null)
	}) as Clang;

	return { clang, stdout };
}

describe('Clang compile/debug flow', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses the supported clang standard and disables optimization for debug runs', async () => {
		const { clang } = createClangHarness();

		await clang.compile({
			input: 'main.cc',
			code: 'int main() {}',
			obj: 'main.o',
			args: ['-DMODE=1'],
			debug: true
		});

		const compileArgs = vi.mocked(clang.run).mock.calls[0]?.slice(2) ?? [];
		expect(compileArgs).toContain('-O0');
		expect(compileArgs).toContain('-std=gnu++2a');
		expect(compileArgs).not.toContain('-g');
		expect(compileArgs).not.toContain('-fstandalone-debug');
		expect(compileArgs).toContain('-DMODE=1');
	});

	it('instruments debug builds with source line hooks', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>

int main() {
    int sum = 0;
    sum += 1;
    printf("%d\\n", sum);
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1];
		expect(String(instrumentedSource)).toContain(
			'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_enter"))) void __wasm_idle_debug_enter(int functionId);'
		);
		expect(String(instrumentedSource)).toContain(
			'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_leave"))) void __wasm_idle_debug_leave(int functionId);'
		);
		expect(String(instrumentedSource)).toContain(
			'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_line"))) void __wasm_idle_debug_line(int functionId, int line);'
		);
		expect(String(instrumentedSource)).toContain('__wasm_idle_debug_line(1, 4);');
		expect(String(instrumentedSource)).toContain('__wasm_idle_debug_line(1, 5);');
	});

	it('instruments function bodies when the opening brace is on the next line', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>
int main()
{
    int sum = 0;
    sum += 1;
    printf("%d\\n", sum);
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain('__wasm_idle_debug_enter(1);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_line(1, 4);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_line(1, 5);');
	});

	it('tracks outer loop mutations without emitting out-of-scope loop variable hooks', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>

int main() {
    int sum = 0;
    for (int value = 1; value <= 4; ++value) sum += value;
    printf("%d\\n", sum);
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 1, sum);');
		expect(instrumentedSource).not.toContain('__wasm_idle_debug_value_num(1, 2, value);');
	});

	it('instruments while conditions so next line can stop on loop headers', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>

int main() {
    int num = 1;
    while (num <= 10) {
        num++;
    }
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain(
			'while ((__wasm_idle_debug_line(1, 5), (num <= 10))) {'
		);
	});

	it('keeps debug hooks for the provided while-loop sample program', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>

int main() {
    int num = 1;
    int sum = 0;

    while(num <= 10) {
        sum += num;
        num++;
    }
    printf("1부터 10까지의 합 = %d\\nwhile문이 끝난 후의 num의 값 = %d", sum, num);
    return 0;
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain(
			'while((__wasm_idle_debug_line(1, 7), (num <= 10))) {'
		);
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 1, num);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 2, sum);');
	});

	it('captures fixed-size array locals with address hooks', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>

int main() {
    int values[3] = {1, 2, 3};
    printf("%d\\n", values[0]);
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain(
			'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_value_addr"))) void __wasm_idle_debug_value_addr(int functionId, int slot, int value);'
		);
		expect(instrumentedSource).toContain(
			'__wasm_idle_debug_value_addr(1, 1, (int)((unsigned long long)(values)));'
		);
		expect(instrumentedSource).not.toContain('__wasm_idle_debug_value_num(1, 1, values);');
	});

	it('captures fixed-size two-dimensional array locals with address hooks', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>

int main() {
    int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
    printf("%d\\n", grid[1][2]);
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain(
			'__wasm_idle_debug_value_addr(1, 1, (int)((unsigned long long)(grid)));'
		);
		expect(instrumentedSource).not.toContain('__wasm_idle_debug_value_num(1, 1, grid);');
	});

	it('captures vector, set, and map locals with text preview hooks', async () => {
		const { clang } = createClangHarness();
		const code = `#include <map>
#include <set>
#include <vector>

int main() {
    std::vector<int> values = {1, 2};
    std::set<int> seen;
    std::map<int, int> counts;
    values.push_back(3);
    seen.insert(2);
    counts[1] = 4;
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain(
			'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_value_text"))) void __wasm_idle_debug_value_text(int functionId, int slot, const char* ptr, int len);'
		);
		expect(instrumentedSource).toContain(
			'__wasm_idle_debug_emit_vector(1, 1, values);'
		);
		expect(instrumentedSource).toContain(
			'__wasm_idle_debug_emit_set(1, 2, seen);'
		);
		expect(instrumentedSource).toContain(
			'__wasm_idle_debug_emit_map(1, 3, counts);'
		);
	});

	it('skips pointer locals and parameters in the provided recursive sequence sample', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>
#include <stdlib.h>
void seq(int *path, int N){
    if (N <= 0) return;
    
    path[N] = N;
    seq(path, N - 2);
}

void print_seq(int *path, int N){
    for (int i = 0; i <= N; i++){
        if (path[i] != 0) {
            printf("%d ",path[i]);
        }
    }
}

int main(){
    int N = 0;
    if (scanf("%d",&N) == 1 && N >= 1){

        int *path = (int *)calloc(N + 1, sizeof(int));

        if (path == NULL) {
            return 1;
        }

        seq(path, N);
        print_seq(path, N);

        free(path);

        return 0;
    }
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).not.toContain('__wasm_idle_debug_value_num(1, 1, path);');
		expect(instrumentedSource).not.toContain('__wasm_idle_debug_value_num(3, 2, path);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 1, N);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(2, 1, N);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(3, 1, N);');
	});

	it('keeps next-line brace for-loops intact for the provided alphabet pyramid sample', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>
int main()
{
    int i,j,n;
    int c=0;
    scanf("%d",&n);
    for(i=1;i<=n;i++)
    {
        c=(i-1)%26;
        for(j=1;j<=(n-i)*2;j++)
        {
            printf(" ");
        }
        for(j=1;j<=i;j++)
        {
            printf("%c ",c%26+'A');
            c+=n-j;
        }
        printf("\\n");
    }
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain(
			'for((i=1, __wasm_idle_debug_value_num(1, 1, i)); (__wasm_idle_debug_line(1, 7), (i<=n)); (i++, __wasm_idle_debug_value_num(1, 1, i)))'
		);
		expect(instrumentedSource).toContain(
			'for((j=1, __wasm_idle_debug_value_num(1, 2, j)); (__wasm_idle_debug_line(1, 10), (j<=(n-i)*2)); (j++, __wasm_idle_debug_value_num(1, 2, j)))'
		);
		expect(instrumentedSource).toContain(
			'for((j=1, __wasm_idle_debug_value_num(1, 2, j)); (__wasm_idle_debug_line(1, 14), (j<=i)); (j++, __wasm_idle_debug_value_num(1, 2, j)))'
		);
		expect(instrumentedSource).toMatch(
			/for\(\(i=1, __wasm_idle_debug_value_num\(1, 1, i\)\); \(__wasm_idle_debug_line\(1, 7\), \(i<=n\)\); \(i\+\+, __wasm_idle_debug_value_num\(1, 1, i\)\)\)\s*\n\s*\{/
		);
		expect(instrumentedSource).not.toMatch(
			/for\(\(i=1, __wasm_idle_debug_value_num\(1, 1, i\)\); \(__wasm_idle_debug_line\(1, 7\), \(i<=n\)\); \(i\+\+, __wasm_idle_debug_value_num\(1, 1, i\)\)\)\s*\n\s*__wasm_idle_debug_value_num/
		);
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 1, i))');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 2, j))');
	});

	it('registers comma-separated locals and refreshes pointer-written values', async () => {
		const { clang } = createClangHarness();
		const code = `#include <stdio.h>

int main() {
    int a, b, c;
    int result1, result2, result3, result4;
    scanf("%d %d %d", &a, &b, &c);
    result1 = (a == b);
}`;

		await clang.compile({
			input: 'main.cc',
			code,
			obj: 'main.o',
			debug: true
		});

		const instrumentedSource = String(vi.mocked(clang.memfs.addFile).mock.calls[0]?.[1] || '');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 1, a);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 2, b);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 3, c);');
		expect(instrumentedSource).toContain('__wasm_idle_debug_value_num(1, 4, result1);');
	});

	it('imports unresolved debug hooks during debug links', async () => {
		const { clang } = createClangHarness();

		await Clang.prototype.link.call(clang, 'main.o', 'main.wasm', true);

		const linkArgs = vi.mocked(clang.run).mock.calls[0]?.slice(2) ?? [];
		expect(linkArgs).toContain('--allow-undefined');
	});

	it('reuses cached wasm only when the debug/build key matches', async () => {
		const compileWasm = vi
			.spyOn(WebAssembly, 'compile')
			.mockResolvedValue({ id: 'wasm-module' } as unknown as WebAssembly.Module);
		const { clang } = createClangHarness();
		clang.compile = vi.fn(async () => null) as any;

		await clang.compileLink('int main() {}', { args: ['-DTEST=1'], debug: false });
		await clang.compileLink('int main() {}', { args: ['-DTEST=1'], debug: false });
		await clang.compileLink('int main() {}', { args: ['-DTEST=1'], debug: true });

		expect(vi.mocked(clang.compile)).toHaveBeenCalledTimes(2);
		expect(vi.mocked(clang.link)).toHaveBeenCalledTimes(2);
		expect(compileWasm).toHaveBeenCalledTimes(2);
	});
});
