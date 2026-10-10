/** Unmodified Darren Smith GolfScript CLI, executed by the pinned Ruby/WASI runtime. */
export const WASM_GOLFSCRIPT_INTERPRETER_RECEIPT = Object.freeze({
	fileName: 'golfscript.rb',
	upstreamCommit: 'cded542533c2c8f72ab2d5935714f739b0357690',
	bytes: 19231,
	sha256: '84f932a624b19afe6ef2a3ebe09a9b832f765a87460a79cde22323615c468f38'
});

export const WASM_GOLFSCRIPT_ASSET_VERSION = WASM_GOLFSCRIPT_INTERPRETER_RECEIPT.sha256.slice(
	0,
	16
);

/** The interpreter mount is separate from caller-owned source/workspace files. */
export const GOLFSCRIPT_RUNTIME_DIRECTORY = '__wasm_idle_golfscript__';
