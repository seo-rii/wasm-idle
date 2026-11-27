import { readFileSync } from 'node:fs';

// Linux exposes AVX only when the kernel can preserve the extended registers.
// Check every available CPU, since the process may migrate between them.
export function executionCommand(file, cpu = 'x86-64') {
	if (cpu === 'x86-64') return { command: file, args: [], mode: 'native' };
	const profiles = {
		avx2: ['avx2'],
		'avx2-fma': ['avx2', 'fma'],
		'x86-64-v3': ['avx2', 'fma', 'bmi1', 'bmi2', 'f16c', 'movbe', 'abm|lzcnt', 'xsave',
			'cx16', 'lahf_lm', 'popcnt', 'pni|sse3', 'ssse3', 'sse4_1', 'sse4_2']
	};
	const required = profiles[cpu];
	if (!required) throw new Error(`Unknown x86 execution profile: ${cpu}`);
	const cores = [...readFileSync('/proc/cpuinfo', 'utf8').matchAll(/^flags\s*:\s*(.+)$/gm)]
		.map((line) => new Set(line[1].trim().split(/\s+/)));
	if (cores.length && cores.every((flags) =>
		required.every((feature) => feature.split('|').some((alias) => flags.has(alias)))))
		return { command: file, args: [], mode: 'native' };
	return { command: 'qemu-x86_64', args: ['-cpu', 'max', file], mode: 'qemu' };
}
