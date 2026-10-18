export const NIM_LLVM_PROFILE = Object.freeze({
	id: 'nim-llvm8',
	version: 1,
	nimVersion: '2.2.4',
	llvmVersion: '8.0.1',
	resourceDir: '/lib/clang/8.0.1',
	requiredAssets: [
		'clang/clang.js',
		'clang/clang.wasm',
		'clang/lld.wasm',
		'clang/memfs.wasm',
		'clang/sysroot.tar'
	]
});
