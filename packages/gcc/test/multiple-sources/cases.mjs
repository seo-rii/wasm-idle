// Run with scripts/verify-x86-cross-gcc.mjs and a real, independently pinned bundle.
const files = [
	{ path: 'shared.h', contents: 'long long triangular(long long); int bias(void);\n' },
	{ path: 'nested/private.h', contents: '#define HELPER_BIAS 5\n' },
	{
		path: 'nested/helper.cpp',
		contents:
			'#include "private.h"\n#ifdef PRIMARY_UNIT_ONLY\n#error primary macro leaked into another translation unit\n#endif\nstatic int local_value = HELPER_BIAS;\nlong long triangular(long long n) { return n * (n + 1) / 2 + local_value; }\n'
	},
	{
		path: 'bias.cpp',
		contents: 'static int local_value = 11;\nint bias(void) { return local_value; }\n'
	},
	{ path: 'unused.cpp', contents: '#error unselected source must not be compiled\n' }
];
const cpp = {
	language: 'cpp',
	standard: 'c++17',
	cpu: 'x86-64',
	emit: 'executable',
	files,
	sources: ['nested/helper.cpp', 'bias.cpp']
};

export const cases = [
	{
		id: 'cpp-separate-units',
		fixture: 'main.c',
		request: cpp,
		stdin: '4\n',
		stdout: '26 2\n',
		stageCount: 7
	},
	{
		id: 'c-separate-units',
		fixture: 'main.c',
		request: { ...cpp, language: 'c', standard: 'c17' },
		stdin: '7\n',
		stdout: '44 2\n',
		stageCount: 7
	},
	{
		id: 'cpp-unselected-source',
		fixture: 'standalone.cpp',
		request: {
			language: 'cpp',
			cpu: 'x86-64',
			emit: 'executable',
			files: [{ path: 'unused.cpp', contents: '#error not a translation unit\n' }]
		},
		stdin: '41\n',
		stdout: '42\n',
		stageCount: 3
	},
	{
		id: 'cpp-secondary-error',
		fixture: 'main.c',
		expectFailure: true,
		request: {
			...cpp,
			files: files.map((file) =>
				file.path === 'nested/helper.cpp'
					? { ...file, contents: '#error secondary unit failed intentionally\n' }
					: file
			)
		},
		stageCount: 3,
		failureTool: 'cc1plus',
		diagnostic: 'secondary unit failed intentionally'
	},
	{
		id: 'cpp-unresolved-link',
		fixture: 'main.c',
		expectFailure: true,
		request: { ...cpp, sources: ['nested/helper.cpp'] },
		stageCount: 5,
		failureTool: 'ld',
		diagnostic: 'undefined reference'
	},
	{
		id: 'cpp-duplicate-definition',
		fixture: 'main.c',
		expectFailure: true,
		request: {
			...cpp,
			files: [
				...files,
				{ path: 'duplicate.cpp', contents: 'int bias(void) { return 99; }\n' }
			],
			sources: [...cpp.sources, 'duplicate.cpp']
		},
		stageCount: 9,
		failureTool: 'ld',
		diagnostic: 'multiple definition'
	},
	{
		id: 'cpp-recovery-after-failures',
		fixture: 'main.c',
		request: cpp,
		stdin: '-4\n',
		stdout: '22 2\n',
		stageCount: 7
	},
	{
		id: 'cpp-preprocessed-units',
		fixture: 'preprocessed.ii',
		request: {
			language: 'cpp',
			cpu: 'x86-64',
			emit: 'executable',
			preprocessed: true,
			files: [{ path: 'helper.ii', contents: 'int helper() { return 7; }\n' }],
			sources: ['helper.ii']
		},
		stdin: '',
		stdout: '7\n',
		stageCount: 5
	}
];
