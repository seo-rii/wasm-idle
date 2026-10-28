// Shared by native GCC and Chromium Worker qualification. These are ordinary
// C/C++ programs; the harness never substitutes or interprets their source.
const c = { language: 'c', emit: 'executable', standard: 'gnu11', optimization: '0' };
const cpp = { language: 'cpp', emit: 'executable', standard: 'gnu++17', optimization: '0' };
const typedefVoidCode = `#include <stdio.h>
typedef void V;
static volatile int value;
__attribute__((noinline)) V f() { value += 19; return; }
__attribute__((noinline)) void g() { value += 23; return; }
static V (*volatile callback)() = f;
int main() { callback(); g(); printf("%d\\n", value); return 0; }
`;
const wideIntegerCode = `#include <stdio.h>
int main(void) {
  unsigned long long n;
  if (scanf("%llu", &n) != 1) return 2;
  unsigned long long mixed = n ^ 0xfedcba9876543210ULL;
  long long signed_value = -4294967303LL - (long long)n;
  printf("%llu %lld %llu\\n", mixed, signed_value, mixed / 17ULL);
  return 0;
}
`;

const baseCases = [
	{
		id: 'c-hello',
		features: ['libc', 'stdin', 'stdout'],
		request: {
			...c,
			code: '#include <stdio.h>\nint main(void) { int n; if (scanf("%d", &n) != 1) return 2; printf("gcc-wasi %d\\n", n + 7); return 0; }\n'
		},
		stdin: '35\n',
		stdout: 'gcc-wasi 42\n'
	},
	{
		id: 'c-core',
		features: [
			'integers',
			'floating-point',
			'branches',
			'loops',
			'functions',
			'function-pointers',
			'globals',
			'structs',
			'malloc'
		],
		request: {
			...c,
			code: `#include <stdio.h>
#include <stdlib.h>
struct Pair { int first; int second; };
static int bias = 3;
__attribute__((noinline)) static int transform(int n) { return n * n + bias; }
static int (*volatile operation)(int) = transform;
int main(void) {
  int n; double x;
  if (scanf("%d %lf", &n, &x) != 2 || n < 1 || n > 100) return 2;
  struct Pair *items = (struct Pair *)malloc((unsigned)n * sizeof(struct Pair));
  if (!items) return 3;
  int sum = 0;
  for (int i = 0; i < n; ++i) {
    items[i].first = i + 1;
    items[i].second = operation(items[i].first);
    sum += items[i].second;
  }
  if (sum > 20) sum -= 2; else sum += 2;
  printf("%d %.2f %d\\n", sum, x * 1.5 + 0.25, items[n-1].first);
  free(items);
  return 0;
}
`
		},
		stdin: '4 2.5\n',
		stdout: '40 4.00 4\n'
	},
	{
		id: 'c-libm',
		features: ['libc', 'libm', 'dynamic-math-input'],
		request: {
			...c,
			code: `#include <math.h>
#include <stdio.h>
int main(void) {
  double x, y;
  if (scanf("%lf %lf", &x, &y) != 2) return 2;
  printf("%.4f %.4f %.4f %.4f %.4f\\n", sqrt(x), pow(x,y), sin(y), cos(y), log(x));
  return 0;
}
`
		},
		stdin: '4 0\n',
		stdout: '2.0000 1.0000 0.0000 1.0000 1.3863\n'
	},
	...['0', '2'].map((optimization) => ({
		id: `c-wide-integers-o${optimization}`,
		features: [
			'i64-constants',
			'u64-constants',
			'i64-arithmetic',
			'u64-division',
			'i64-varargs'
		],
		request: { ...c, optimization, code: wideIntegerCode },
		stdin: '9\n',
		stdout: '18364758544493064729 -4294967312 1080279914381944984\n'
	})),
	{
		id: 'c-errno',
		features: ['libc', 'errno-storage', 'strtol-overflow', 'wasi-libc-abi'],
		request: {
			...c,
			code: `#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
int main(void) {
  char input[128];
  if (scanf("%127s", input) != 1) return 2;
  errno = 0;
  long value = strtol(input, 0, 10);
  int overflow = errno == ERANGE;
  printf("%d %d\\n", value == LONG_MAX, overflow);
  return 0;
}
`
		},
		stdin: '99999999999999999999999999999\n',
		stdout: '1 1\n'
	},
	{
		id: 'c-multiple',
		features: [
			'c-multiple-translation-units',
			'user-headers',
			'external-globals',
			'struct-abi'
		],
		request: {
			...c,
			code: `#include <stdio.h>
#include "shared.h"
int main(void) { int n; if (scanf("%d", &n) != 1) return 2; struct Pair p = make_pair(n); printf("%d %d %d\\n", p.left, p.right, pair_sum(p)); return 0; }
`,
			files: [
				{
					path: 'shared.h',
					contents:
						'struct Pair { int left; int right; };\nextern int offset;\nstruct Pair make_pair(int);\nint pair_sum(struct Pair);\n'
				},
				{
					path: 'pair.c',
					contents:
						'#include "shared.h"\nint offset = 7;\nstruct Pair make_pair(int n) { struct Pair p = {n, n + offset}; return p; }\n'
				},
				{
					path: 'sum.c',
					contents:
						'#include "shared.h"\nint pair_sum(struct Pair p) { return p.left + p.right; }\n'
				}
			],
			sources: ['pair.c', 'sum.c']
		},
		stdin: '9\n',
		stdout: '9 16 25\n'
	},
	{
		id: 'c-defines',
		features: ['command-line-macros', 'gcc-frontend-identity'],
		request: {
			...c,
			defines: ['ONLINE_JUDGE=1', 'ANSWER_OFFSET=7'],
			code: `#include <stdio.h>
#if !defined(__GNUC__) || defined(__clang__)
#error This qualification case requires the actual GCC frontend.
#endif
#if !defined(ONLINE_JUDGE) || ONLINE_JUDGE != 1
#error ONLINE_JUDGE must be passed as a compiler definition.
#endif
int main(void) { int n; if (scanf("%d", &n) != 1) return 2; printf("%d %d\\n", ONLINE_JUDGE, n + ANSWER_OFFSET); return 0; }
`
		},
		stdin: '35\n',
		stdout: '1 42\n',
		clangReference: false
	},
	{
		id: 'c-wasm32-abi',
		features: ['wasm32-data-model', 'scalar-alignment', 'little-endian'],
		request: {
			...c,
			code: `#include <stdio.h>
#include <stddef.h>
struct Layout { char c; long long n; void *p; };
int main(void) {
  unsigned value = 1;
  printf("%u %u %u %u %u %u %u %u %u %u\\n", (unsigned)sizeof(void *), (unsigned)sizeof(int), (unsigned)sizeof(long), (unsigned)sizeof(long long), (unsigned)sizeof(float), (unsigned)sizeof(double), (unsigned)_Alignof(double), (unsigned)offsetof(struct Layout,n), (unsigned)offsetof(struct Layout,p), (unsigned)*(unsigned char *)&value);
  return 0;
}
`
		},
		stdin: '',
		stdout: '4 4 4 8 4 8 8 8 16 1\n'
	},
	{
		id: 'cpp-core',
		features: ['c++-frontend', 'static-initialization', 'constructors', 'templates'],
		request: {
			...cpp,
			code: `#include <stdio.h>
static int initialized = 0;
struct Initializer { Initializer() { initialized = 11; } };
static Initializer initializer;
template<class T> T twice(T n) { return n + n; }
int main() { int n; if (scanf("%d", &n) != 1) return 2; printf("%d %d\\n", initialized, twice(n)); return 0; }
`
		},
		stdin: '21\n',
		stdout: '11 42\n'
	},
	{
		id: 'cpp-iostream',
		features: ['libstdc++', 'iostream', 'cin', 'cout', 'stdin', 'stdout'],
		request: {
			...cpp,
			code: `#include <iostream>
int main() {
  int n;
  if (!(std::cin >> n)) return 2;
  std::cout << "gcc-iostream " << n + 7 << '\\n';
  return 0;
}
`
		},
		stdin: '35\n',
		stdout: 'gcc-iostream 42\n'
	},
	{
		id: 'cpp-static-lifecycle',
		features: [
			'global-static-initialization',
			'local-static-initialization',
			'one-time-local-initialization',
			'static-destructors',
			'reverse-destruction-order'
		],
		request: {
			...cpp,
			code: `#include <stdio.h>
static int global_value = 0;
static int local_builds = 0;
struct Global {
  Global() { global_value = 7; }
  ~Global() { printf("global %d\\n", global_value); }
};
static Global global;
struct Local {
  int value;
  Local(int n) : value(n) { ++local_builds; }
  ~Local() { printf("local %d\\n", value); }
};
__attribute__((noinline)) int touch(int n) {
  static Local local(n);
  return local.value;
}
int main() {
  int n;
  if (scanf("%d", &n) != 1) return 2;
  int first = touch(n);
  int second = touch(n + 100);
  printf("%d %d %d %d\\n", global_value, first, second, local_builds);
  return 0;
}
`
		},
		stdin: '13\n',
		stdout: '7 13 13 1\nlocal 13\nglobal 7\n'
	},
	...['0', '2'].map((optimization) => ({
		id: `cpp-typedef-void-o${optimization}`,
		features: ['typedef-void-return', 'indirect-void-call', 'explicit-void-return'],
		request: { ...cpp, optimization, code: typedefVoidCode },
		stdin: '',
		stdout: '42\n'
	})),
	{
		id: 'cpp-stl-multiple',
		features: [
			'libstdc++',
			'vector',
			'string',
			'algorithm',
			'c++-multiple-translation-units',
			'static-initialization',
			'user-headers'
		],
		request: {
			...cpp,
			code: `#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>
#include "shared.hpp"
int main() {
  int n; if (std::scanf("%d", &n) != 1) return 2;
  std::vector<int> values{n, 7, -2};
  std::sort(values.begin(), values.end());
  std::string label = make_label();
  std::printf("%s %d %d %d\\n", label.c_str(), values[0], values[2], initialized_value());
  return 0;
}
`,
			files: [
				{
					path: 'shared.hpp',
					contents:
						'#include <string>\nstd::string make_label();\nint initialized_value();\n'
				},
				{
					path: 'shared.cpp',
					contents:
						'#include "shared.hpp"\nstatic std::string label("gcc");\nstatic int value = static_cast<int>(label.size()) + 8;\nstd::string make_label() { return label + "-stl"; }\nint initialized_value() { return value; }\n'
				}
			],
			sources: ['shared.cpp']
		},
		stdin: '9\n',
		stdout: 'gcc-stl -2 9 11\n'
	}
];

export const cases = [
	...baseCases,
	...['cpp-iostream', 'cpp-stl-multiple'].map((id) => {
		const fixture = baseCases.find((entry) => entry.id === id);
		return { ...fixture, id: `${id}-o2`, request: { ...fixture.request, optimization: '2' } };
	})
];

export function selectCases(selection, available = cases) {
	if (!selection || selection === 'all') return available;
	const ids = selection.split(',');
	if (new Set(ids).size !== ids.length) throw new Error('Case selection contains duplicates');
	return ids.map((id) => {
		const fixture = available.find((entry) => entry.id === id);
		if (!fixture) throw new Error(`Unknown GCC WASI qualification case: ${id}`);
		return fixture;
	});
}
