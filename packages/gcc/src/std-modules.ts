import type { gccCompileInputs } from './plan.js';
import type { WasiGccCompileRequest } from './types.js';

export const gccStdModulesProfile = Object.freeze({
	standard: 'gnu++23',
	optimization: '2',
	exceptions: false,
	rtti: false,
	targetExceptionHandling: true,
	signalEmulation: true,
	cxx11Abi: 1,
	dualAbi: true,
	glibcxxDebug: false,
	simd: false,
	relaxedSimd: false,
	atomics: false,
	tls: false,
	sharedMemory: false,
	debug: false,
	coverage: false,
	defines: Object.freeze(['__GCC_WASI_SINGLE_THREAD__=1', '_WASI_EMULATED_SIGNAL=1'] as const)
});

export const gccStdModulesAssetPaths = Object.freeze({
	std: 'std-modules/std.gcm',
	stdCompat: 'std-modules/std.compat.gcm',
	initializers: 'std-modules/libstdc++modules.a',
	signal: 'std-modules/libwasi-emulated-signal.a'
});

// These files belong to the compiler, outside all caller-supplied workspace paths.
export const gccStdModulesDirectory = '/gcc-std-modules';
export const gccStdModulesMapperPath = `${gccStdModulesDirectory}/mapper.txt`;
export const gccStdModulesMapper =
	`std ${gccStdModulesDirectory}/std.gcm\n` +
	`std.compat ${gccStdModulesDirectory}/std.compat.gcm\n`;

/** Request admission only. Bundle and module bytes require separate qualification checks. */
export function validateGccStdModulesProfile(
	request: WasiGccCompileRequest,
	inputs: Pick<
		ReturnType<typeof gccCompileInputs>,
		'language' | 'emit' | 'optimization' | 'standard' | 'definitions'
	>
) {
	if (request.stdModules !== undefined && typeof request.stdModules !== 'boolean')
		throw new Error('Invalid GCC stdModules option');
	if (request.stdModules !== true) return false;
	if (inputs.language !== 'cpp') throw new Error('GCC std modules require C++ source');
	if (inputs.standard !== 'gnu++23')
		throw new Error('GCC std modules require explicit standard=gnu++23');
	if (inputs.optimization !== '2') throw new Error('GCC std modules require optimization=2');
	if (inputs.emit !== 'executable') throw new Error('GCC std modules require executable output');
	if (request.preprocessed !== undefined && request.preprocessed !== false)
		throw new Error('GCC std modules require ordinary source, not preprocessed input');
	if (inputs.definitions.length)
		throw new Error('GCC std modules do not support caller macro definitions');
	if (
		request.linkInputs !== undefined &&
		(!Array.isArray(request.linkInputs) || request.linkInputs.length > 0)
	)
		throw new Error('GCC std modules require source-only compilation without linkInputs');
	if (request.sharedMemory !== undefined)
		throw new Error('GCC std modules require private memory');
	for (const feature of [
		'exceptions',
		'rtti',
		'simd',
		'relaxedSimd',
		'atomics',
		'tls',
		'coverage',
		'debug',
		'threads',
		'dynamicLinking'
	] as const)
		if (request[feature] !== undefined && request[feature] !== false)
			throw new Error(`GCC std modules with ${feature} are not qualified`);
	return true;
}
