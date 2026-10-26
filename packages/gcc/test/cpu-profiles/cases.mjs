// Real GCC inputs for scripts/verify-x86-cross-gcc.mjs; not synthetic compiler fixtures.
export const cases = [];
for (const language of ['c', 'cpp']) {
	for (const cpu of ['x86-64', 'avx2', 'avx2-fma']) {
		cases.push({
			id: `${language}-${cpu}`,
			fixture: 'profiles.c',
			request: {
				language,
				cpu,
				emit: 'assembly',
				optimization: '3',
				standard: language === 'c' ? 'c17' : 'c++20',
				files: [
					{
						path: 'expected-profile.h',
						contents: `#define EXPECT_AVX2 ${Number(cpu !== 'x86-64')}\n#define EXPECT_FMA ${Number(cpu === 'avx2-fma')}\n`
					}
				]
			}
		});
	}
	for (const cpu of ['x86-64', 'avx2', 'avx2-fma']) {
		cases.push({
			id: `${language}-${cpu}-fma-intrinsic`,
			fixture: 'fma-intrinsic.c',
			expectFailure: cpu !== 'avx2-fma',
			request: {
				language,
				cpu,
				emit: 'assembly',
				optimization: '2',
				standard: language === 'c' ? 'c17' : 'c++20'
			}
		});
	}
}
