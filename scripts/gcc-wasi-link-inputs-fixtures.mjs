// Actual external compilation inputs for issue #342. The preparation script
// builds these sources with the pinned native GCC/Clang and real llvm-ar.
export const providers = [
	{
		id: 'callback',
		code: 'int apply_external(int n, int (*callback)(int)) { return callback(n) + 4; }\n'
	},
	{ id: 'first', code: 'int selected_value(void) { return 11; }\n', archive: true },
	{ id: 'second', code: 'int selected_value(void) { return 22; }\n', archive: true },
	{
		id: 'initializer',
		language: 'cpp',
		archive: true,
		code: 'static int state; struct Init { Init() { state = 41; } }; static Init instance; extern "C" int initialized_value() { return state; }\n'
	},
	{
		id: 'clang-callback',
		compiler: 'clang',
		code: 'int apply_external(int n, int (*callback)(int)) { return callback(n) + 4; }\n'
	},
	{
		id: 'simd',
		simd: true,
		code: 'typedef int V __attribute__((vector_size(16))); int external_simd(int n) { volatile V input = { n, 2, 3, 4 }; V a = input, b = { 1, 1, 1, 1 }; V result = a + b; return result[0] + result[1] + result[2] + result[3]; }\n'
	}
];

export function createCases(inputs) {
	return ['0', '2'].flatMap((optimization) => {
		const input = (id) => inputs[`${id}-o${optimization}`];
		const common = { language: 'c', optimization, standard: 'gnu11', simd: false };
		const callback = {
			...common,
			code: '#include <stdio.h>\nint source_bias(void); int apply_external(int, int (*)(int)); static int callback(int n) { return n + source_bias(); } int main(void) { int n; if (scanf("%d", &n) != 1) return 1; printf("object %d\\n", apply_external(n, callback)); return 0; }\n',
			files: [{ path: 'extra.c', contents: 'int source_bias(void) { return 3; }\n' }],
			sources: ['extra.c']
		};
		const archive =
			'#include <stdio.h>\nint selected_value(void); int main(void) { int n; if (scanf("%d", &n) != 1) return 1; printf("archive %d\\n", n + selected_value()); return 0; }\n';
		return [
			{
				id: `external-gcc-object-o${optimization}`,
				features: ['external-gcc-object', 'multi-tu', 'function-pointer'],
				request: { ...callback, linkInputs: [input('callback')] },
				stdin: '35\n',
				stdout: 'object 42\n'
			},
			{
				id: `external-archive-first-o${optimization}`,
				features: ['static-archive', 'archive-order', 'lazy-member-extraction'],
				request: {
					...common,
					code: archive,
					linkInputs: [input('first'), input('second')]
				},
				stdin: '31\n',
				stdout: 'archive 42\n'
			},
			{
				id: `external-archive-second-o${optimization}`,
				features: ['static-archive', 'archive-order', 'lazy-member-extraction'],
				request: {
					...common,
					code: archive,
					linkInputs: [input('second'), input('first')]
				},
				stdin: '31\n',
				stdout: 'archive 53\n'
			},
			{
				id: `external-cpp-initializer-o${optimization}`,
				features: ['static-archive', 'cpp-static-initialization', 'same-gcc-bundle'],
				request: {
					...common,
					language: 'cpp',
					standard: 'gnu++17',
					code: '#include <stdio.h>\nextern "C" int initialized_value(); int main() { int n; if (scanf("%d", &n) != 1) return 1; printf("initializer %d\\n", n + initialized_value()); return 0; }\n',
					linkInputs: [input('initializer')]
				},
				stdin: '1\n',
				stdout: 'initializer 42\n'
			},
			{
				id: `external-clang-scalar-o${optimization}`,
				features: [
					'external-clang-object',
					'declared-scalar-c-contract',
					'function-pointer'
				],
				request: { ...callback, linkInputs: [input('clang-callback')] },
				stdin: '35\n',
				stdout: 'object 42\n'
			},
			{
				id: `external-gcc-simd-o${optimization}`,
				features: ['external-gcc-object', 'simd128'],
				request: {
					...common,
					simd: true,
					code: '#include <stdio.h>\nint external_simd(int); int main(void) { int n; if (scanf("%d", &n) != 1) return 1; printf("simd %d\\n", external_simd(n)); return 0; }\n',
					linkInputs: [input('simd')]
				},
				stdin: '29\n',
				stdout: 'simd 42\n'
			}
		];
	});
}
