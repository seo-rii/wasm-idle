const identifier = '[A-Za-z_$][\\w$]*';
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function patchWasmOfOcamlSystemBridge(source) {
	// js_of_ocaml 6.3 emits px(d+b), while 6.5 emits rQ(b+a). Locate the
	// command-status conversion without depending on minified variable names.
	// The boundary prevents quadratic retries inside embedded runtime strings.
	const callPattern = new RegExp(
		`(?<![\\w$])(${identifier})\\(${identifier}\\+${identifier}\\)!==0\\?1:0`,
		'gu'
	);
	const names = new Set([...source.matchAll(callPattern)].map((match) => match[1]));
	const candidates = [];
	for (const systemFunctionName of names) {
		const declaration = `function\\s+${escapeRegExp(systemFunctionName)}\\((${identifier})\\)\\{`;
		for (const alreadyPatched of [false, true]) {
			const hook = alreadyPatched
				? 'if\\(globalThis\\.__wasm_of_js_system_command\\)return globalThis\\.__wasm_of_js_system_command\\(\\1\\);'
				: '';
			const pattern = new RegExp(`${declaration}${hook}return (${identifier})\\}`, 'gu');
			for (const match of source.matchAll(pattern)) {
				candidates.push({
					systemFunctionName,
					argumentName: match[1],
					fallbackValue: match[2],
					alreadyPatched,
					start: match.index,
					length: match[0].length
				});
			}
		}
	}
	if (candidates.length !== 1) {
		throw new Error(`expected one Binaryen system command stub, found ${candidates.length}`);
	}
	const { systemFunctionName, argumentName, fallbackValue, alreadyPatched, start, length } =
		candidates[0];
	const replacement = `function\n${systemFunctionName}(${argumentName}){if(globalThis.__wasm_of_js_system_command)return globalThis.__wasm_of_js_system_command(${argumentName});return ${fallbackValue}}`;
	return {
		source: alreadyPatched
			? source
			: source.slice(0, start) + replacement + source.slice(start + length),
		systemFunctionName,
		alreadyPatched
	};
}
