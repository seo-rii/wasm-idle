import type {
	DebugArrayElementKind,
	DebugVariable,
	DebugVariableMetadata
} from '$lib/playground/options';
import App from '$lib/clang/app';
import { MemFS, untar } from '$lib/clang/memory';
import { green, yellow, normal } from '$lib/clang/color';
import { compile, readBuffer } from '$lib/clang/wasm';
import { clangUrl, lldUrl, rootUrl } from '$lib/clang/url';
import { derived, type Writable, writable } from 'svelte/store';

const clangCommonArgs = [
	'-disable-free',
	'-isysroot',
	'/',
	'-internal-isystem',
	'/include/c++/v1',
	'-internal-isystem',
	'/include',
	'-internal-isystem',
	'/lib/clang/8.0.1/include',
	'-ferror-limit',
	'19',
	'-fmessage-length',
	'80',
	'-fcolor-diagnostics'
];

const clangLanguageStandardArg = '-std=gnu++2a';

interface APIOption {
	stdin: () => string;
	stdout: (str: string) => void;
	progress: (value: number) => void;
	onDebugEvent?: (event: { type: 'pause'; line: number; reason: string; locals: DebugVariable[] }) => void;

	log?: boolean;
	showTiming?: boolean;
	path: string;
}

interface DebugRunOptions {
	args?: string[];
	debug?: boolean;
	breakpoints?: number[];
	pauseOnEntry?: boolean;
	debugBuffer?: Int32Array;
	interruptBuffer?: Uint8Array;
}

const toUtf8 = (text: string) => {
	const surrogate = encodeURIComponent(text);
	let result = '';
	for (let i = 0; i < surrogate.length; ) {
		const character = surrogate[i];
		i += 1;
		if (character == '%') {
			const hex = surrogate.substring(i, (i += 2));
			if (hex) result += String.fromCharCode(parseInt(hex, 16));
		} else {
			result += character;
		}
	}
	return result;
};

export default class Clang {
	ready: Promise<void>;
	memfs: MemFS;
	stdout: (str: string) => void;
	moduleCache: { [key: string]: WebAssembly.Module };

	showTiming: boolean;
	log: boolean;
	debug = false;
	debugBreakpoints = new Set<number>();
	debugPauseOnEntry = false;
	debugBuffer?: Int32Array;
	debugInterruptBuffer?: Uint8Array;
	onDebugEvent?: (event: {
		type: 'pause';
		line: number;
		reason: string;
		locals: DebugVariable[];
		callStack: { functionName: string; line: number }[];
	}) => void;
	debugVariableMetadata: Record<number, DebugVariableMetadata[]> = {};
	debugGlobalMetadata: DebugVariableMetadata[] = [];
	debugFunctionMetadata: Record<number, string> = {};
	lastBuildKey = '';
	path: string;
	wasm?: WebAssembly.Module;
	traceStartedAt = 0;
	progress = {
		clang: writable(0),
		lld: writable(0),
		memfs: writable(0)
	};

	constructor(options: APIOption) {
		this.moduleCache = {};
		this.stdout = options.stdout;
		this.showTiming = options.showTiming || false;
		this.log = options.log || false;
		this.path = options.path;
		this.onDebugEvent = options.onDebugEvent;

		this.memfs = new MemFS({
			stdout: this.stdout,
			stdin: options.stdin,
			path: this.path,
			progress: this.progress.memfs,
			trace: (message) => this.trace(message)
		});

		const progress = derived(
			[this.progress.clang, this.progress.lld, this.progress.memfs],
			([clang, lld, memfs]) => {
				return (clang + lld + memfs) / 3;
			}
		);
		progress.subscribe((value) => {
			options.progress(value);
		});
		this.getModule(clangUrl(this.path), this.progress.clang);
		this.getModule(lldUrl(this.path), this.progress.lld);
		this.ready = this.memfs.ready.then(() =>
			this.hostLogAsync(
				`Untarring ${rootUrl(this.path)}`,
				readBuffer(rootUrl(this.path)).then((buffer) => untar(buffer, this.memfs))
			)
		);
	}

	hostLog(message: string) {
		if (!this.log) return;
		const yellowArrow = `${yellow}>${normal} `;
		this.stdout(`${yellowArrow}${message}`);
	}

	beginTrace(debug: boolean) {
		this.debug = debug;
		this.traceStartedAt = Date.now();
	}

	trace(message: string) {
		if (!this.debug) return;
		const elapsed = Date.now() - this.traceStartedAt;
		this.stdout(`\x1b[2m[debug +${elapsed}ms] ${message}\x1b[0m\n`);
	}

	async hostLogAsync(message: string, promise: Promise<any>) {
		const start = +new Date();
		this.hostLog(`${message}...`);
		const result = await promise;
		const end = +new Date();
		if (this.log) this.stdout(' done.');
		if (this.showTiming) this.stdout(` ${green}(${end - start}ms)${normal}\n`);
		if (this.log) this.stdout('\n');
		return result;
	}

	async getModule(name: string, progress?: Writable<number>) {
		if (this.moduleCache[name]) return this.moduleCache[name];
		const module = await this.hostLogAsync(
			`Fetching and compiling ${name}`,
			compile(name, progress)
		);
		this.moduleCache[name] = module;
		return module;
	}

	async compile(options: any) {
		const input = options.input;
		let source = options.code;
		const obj = options.obj;
		const debug = !!options.debug;
		const opt = debug ? '0' : (options.opt || '2');
		if (debug) {
			const lines = source.split('\n');
			let braceDepth = 0;
			let functionDepth = 0;
			let currentFunctionId = 0;
			let nextFunctionId = 1;
			let nextVariableSlot = 1;
			let currentFunctionVariables = new Map<
				string,
				{ slot: number; kind: 'number' | 'bool'; fromLine: number; toLine: number }
			>();
			let globalVariables = new Map<
				string,
				{ slot: number; kind: 'number' | 'bool'; fromLine: number; toLine: number }
			>();
			let currentFunctionContainers = new Map<
				string,
				{ slot: number; container: 'vector' | 'set' | 'map'; fromLine: number; toLine: number }
			>();
			let inBlockComment = false;
			let pendingFunctionHeader:
				| {
						functionName: string;
						parameters: string;
				  }
				| undefined;
			this.debugVariableMetadata = {};
			this.debugGlobalMetadata = [];
			this.debugFunctionMetadata = {};
			const globalInitialization: string[] = [];
			const instrumented = [
				'#include <map>',
				'#include <set>',
				'#include <string>',
				'#include <type_traits>',
				'#include <vector>',
				'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_enter"))) void __wasm_idle_debug_enter(int functionId);',
				'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_leave"))) void __wasm_idle_debug_leave(int functionId);',
				'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_value_num"))) void __wasm_idle_debug_value_num(int functionId, int slot, double value);',
				'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_value_bool"))) void __wasm_idle_debug_value_bool(int functionId, int slot, int value);',
				'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_value_addr"))) void __wasm_idle_debug_value_addr(int functionId, int slot, int value);',
				'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_value_text"))) void __wasm_idle_debug_value_text(int functionId, int slot, const char* ptr, int len);',
				'template <typename T>',
				'static inline std::string __wasm_idle_debug_format_value(const T& value) {',
				'    if constexpr (std::is_same_v<T, bool>) return value ? "true" : "false";',
				`    else if constexpr (std::is_same_v<T, char>) return std::string("'") + value + "'";`,
				'    else if constexpr (std::is_same_v<T, signed char> || std::is_same_v<T, unsigned char>) return std::to_string((int)value);',
				'    else if constexpr (std::is_integral_v<T> || std::is_floating_point_v<T>) return std::to_string(value);',
				'    else return "?";',
				'}',
				'template <typename T>',
				'static inline void __wasm_idle_debug_emit_vector(int functionId, int slot, const std::vector<T>& values) {',
				'    std::string text = "[";',
				'    int count = 0;',
				'    for (const auto& value : values) {',
				'        if (count > 0) text += ", ";',
				'        if (count >= 8) { text += "..."; break; }',
				'        text += __wasm_idle_debug_format_value(value);',
				'        count += 1;',
				'    }',
				'    text += "]";',
				'    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());',
				'}',
				'template <typename T>',
				'static inline void __wasm_idle_debug_emit_set(int functionId, int slot, const std::set<T>& values) {',
				'    std::string text = "{";',
				'    int count = 0;',
				'    for (const auto& value : values) {',
				'        if (count > 0) text += ", ";',
				'        if (count >= 8) { text += "..."; break; }',
				'        text += __wasm_idle_debug_format_value(value);',
				'        count += 1;',
				'    }',
				'    text += "}";',
				'    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());',
				'}',
				'template <typename K, typename V>',
				'static inline void __wasm_idle_debug_emit_map(int functionId, int slot, const std::map<K, V>& values) {',
				'    std::string text = "{";',
				'    int count = 0;',
				'    for (const auto& entry : values) {',
				'        if (count > 0) text += ", ";',
				'        if (count >= 8) { text += "..."; break; }',
				'        text += __wasm_idle_debug_format_value(entry.first);',
				'        text += ": ";',
				'        text += __wasm_idle_debug_format_value(entry.second);',
				'        count += 1;',
				'    }',
				'    text += "}";',
				'    __wasm_idle_debug_value_text(functionId, slot, text.c_str(), (int)text.size());',
				'}',
				'extern "C" __attribute__((import_module("env"), import_name("__wasm_idle_debug_line"))) void __wasm_idle_debug_line(int functionId, int line);'
			];
			for (let index = 0; index < lines.length; index += 1) {
				const line = lines[index];
				const indent = line.match(/^\s*/)?.[0] || '';
				let rewrittenLine = line;
				let analysisLine = line;
				if (inBlockComment) {
					const commentEnd = analysisLine.indexOf('*/');
					if (commentEnd === -1) {
						instrumented.push(line);
						continue;
					}
					analysisLine = analysisLine.slice(commentEnd + 2);
					inBlockComment = false;
				}
				const commentStart = analysisLine.indexOf('/*');
				if (commentStart !== -1) {
					const commentEnd = analysisLine.indexOf('*/', commentStart + 2);
					if (commentEnd === -1) {
						inBlockComment = true;
						analysisLine = analysisLine.slice(0, commentStart);
					} else {
						analysisLine =
							analysisLine.slice(0, commentStart) + analysisLine.slice(commentEnd + 2);
					}
				}
				const lineComment = analysisLine.indexOf('//');
				if (lineComment !== -1) analysisLine = analysisLine.slice(0, lineComment);
				const normalized = analysisLine.trim();
				const inFunctionBody = functionDepth > 0 && braceDepth >= functionDepth;
				const isTopLevelDeclarationContext =
					functionDepth === 0 &&
					braceDepth === 0 &&
					!normalized.includes('(') &&
					!normalized.startsWith('#');
				const controlHeaderWithoutInlineBlock =
					/^(while|if|for)\s*\(/.test(normalized) && !normalized.includes('{');
				const leadingInstrumentation: string[] = [];
				const trailingInstrumentation: string[] = [];
				const declaredContainerNames = new Set<string>();
				const globalDeclarationMatch =
					isTopLevelDeclarationContext &&
					normalized.match(
						/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/
					);
				if (globalDeclarationMatch) {
					const kind = globalDeclarationMatch[1] === 'bool' ? 'bool' : 'number';
					const declarations: string[] = [];
					let declarationBuffer = '';
					let declarationBraceDepth = 0;
					for (const character of globalDeclarationMatch[2]) {
						if (character === ',' && declarationBraceDepth === 0) {
							if (declarationBuffer.trim()) declarations.push(declarationBuffer.trim());
							declarationBuffer = '';
							continue;
						}
						if (character === '{') declarationBraceDepth += 1;
						if (character === '}') declarationBraceDepth = Math.max(0, declarationBraceDepth - 1);
						declarationBuffer += character;
					}
					if (declarationBuffer.trim()) declarations.push(declarationBuffer.trim());
					for (const declaration of declarations) {
						const [left] = declaration.split('=');
						const declarator = left?.trim() || '';
						if (/[*&\[]/.test(declarator)) continue;
						const name = declarator.match(/([A-Za-z_]\w*)\s*$/)?.[1];
						if (!name) continue;
						const slot = nextVariableSlot++;
						globalVariables.set(name, {
							slot,
							kind,
							fromLine: index + 1,
							toLine: Number.MAX_SAFE_INTEGER
						});
						this.debugGlobalMetadata = [
							...this.debugGlobalMetadata,
							{
								slot,
								name,
								kind,
								fromLine: index + 1,
								toLine: Number.MAX_SAFE_INTEGER
							}
						];
						globalInitialization.push(
							`${kind === 'bool' ? '__wasm_idle_debug_value_bool' : '__wasm_idle_debug_value_num'}(0, ${slot}, ${name});`
						);
					}
				}
				if (
					inFunctionBody &&
					normalized &&
					!normalized.startsWith('#') &&
					normalized !== '{' &&
					normalized !== '}' &&
					!normalized.startsWith('else') &&
					!normalized.startsWith('case ') &&
					normalized !== 'case' &&
					!normalized.startsWith('default') &&
					!normalized.startsWith('catch') &&
					!/^(public|private|protected)\s*:/.test(normalized) &&
					!normalized.endsWith(':') &&
					!normalized.includes(' else ')
				) {
					leadingInstrumentation.push(
						`${indent}__wasm_idle_debug_line(${currentFunctionId}, ${index + 1});`
					);
						const declarationMatch = normalized.match(
							/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+(.+);$/
						);
						const containerDeclarationMatch = normalized.match(
							/^(?:const\s+)?(?:(?:std::)?(vector|set|map))\s*<(.+)>\s+([A-Za-z_]\w*)\s*(?:=.*)?;$/
						);
						if (containerDeclarationMatch && currentFunctionId) {
							const slot = nextVariableSlot++;
							const container = containerDeclarationMatch[1] as 'vector' | 'set' | 'map';
							const name = containerDeclarationMatch[3];
							declaredContainerNames.add(name);
							currentFunctionContainers.set(name, {
								slot,
								container,
								fromLine: index + 1,
								toLine: Number.MAX_SAFE_INTEGER
							});
							this.debugVariableMetadata[currentFunctionId] = [
								...(this.debugVariableMetadata[currentFunctionId] || []),
								{
									slot,
									name,
									kind: 'text',
									fromLine: index + 1,
									toLine: Number.MAX_SAFE_INTEGER
								}
							];
							trailingInstrumentation.push(
								`${indent}__wasm_idle_debug_emit_${container}(${currentFunctionId}, ${slot}, ${name});`
							);
						}
						if (declarationMatch && currentFunctionId) {
						const kind = declarationMatch[1] === 'bool' ? 'bool' : 'number';
						const declarations: string[] = [];
						let declarationBuffer = '';
						let declarationParenDepth = 0;
						let declarationBraceDepth = 0;
						for (const character of declarationMatch[2]) {
							if (character === ',' && declarationParenDepth === 0 && declarationBraceDepth === 0) {
								if (declarationBuffer.trim()) declarations.push(declarationBuffer.trim());
								declarationBuffer = '';
								continue;
							}
							if (character === '(') declarationParenDepth += 1;
							if (character === ')') declarationParenDepth = Math.max(0, declarationParenDepth - 1);
							if (character === '{') declarationBraceDepth += 1;
							if (character === '}') declarationBraceDepth = Math.max(0, declarationBraceDepth - 1);
							declarationBuffer += character;
						}
						if (declarationBuffer.trim()) declarations.push(declarationBuffer.trim());
							for (const declaration of declarations) {
								const [left] = declaration.split('=');
								const declarator = left?.trim() || '';
								const arrayDimensions: number[] = [];
								for (const match of declarator.matchAll(/\[(\d+)\]/g)) {
									arrayDimensions.push(Number(match[1]));
								}
								const arrayName = declarator.match(/([A-Za-z_]\w*)\s*(?=\[\d+\])/);
								if (arrayDimensions.length && arrayName) {
									const slot = nextVariableSlot++;
									this.debugVariableMetadata[currentFunctionId] = [
										...(this.debugVariableMetadata[currentFunctionId] || []),
										{
											slot,
											name: arrayName[1],
											kind: 'array',
											elementKind: declarationMatch[1] as DebugArrayElementKind,
											length: arrayDimensions[0],
											dimensions: arrayDimensions,
											fromLine: index + 1,
											toLine: Number.MAX_SAFE_INTEGER
										}
									];
									trailingInstrumentation.push(
										`${indent}__wasm_idle_debug_value_addr(${currentFunctionId}, ${slot}, (int)((unsigned long long)(${arrayName[1]})));`
									);
									continue;
								}
							if (/[*&]/.test(declarator)) continue;
							const name = declarator.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?$/)?.[1];
							if (!name) continue;
							if (!currentFunctionVariables.has(name)) {
								const slot = nextVariableSlot++;
								currentFunctionVariables.set(name, {
									slot,
									kind,
									fromLine: index + 1,
									toLine: Number.MAX_SAFE_INTEGER
								});
								this.debugVariableMetadata[currentFunctionId] = [
									...(this.debugVariableMetadata[currentFunctionId] || []),
									{
										slot,
										name,
										kind,
										fromLine: index + 1,
										toLine: Number.MAX_SAFE_INTEGER
									}
								];
							}
							if (declaration.includes('=')) {
								const variable = currentFunctionVariables.get(name);
								if (variable) {
									trailingInstrumentation.push(
										`${indent}${variable.kind === 'bool' ? '__wasm_idle_debug_value_bool' : '__wasm_idle_debug_value_num'}(${currentFunctionId}, ${variable.slot}, ${name});`
									);
								}
							}
						}
					}
					const forDeclarationMatch = normalized.match(
						/^for\s*\(\s*(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(int|float|double|bool|char)\s+([A-Za-z_]\w*)\s*=/
					);
					if (forDeclarationMatch && currentFunctionId) {
						const kind = forDeclarationMatch[1] === 'bool' ? 'bool' : 'number';
						const name = forDeclarationMatch[2];
						if (!currentFunctionVariables.has(name)) {
							const slot = nextVariableSlot++;
							currentFunctionVariables.set(name, {
								slot,
								kind,
								fromLine: index + 1,
								toLine: index + 1
							});
							this.debugVariableMetadata[currentFunctionId] = [
								...(this.debugVariableMetadata[currentFunctionId] || []),
								{
									slot,
									name,
									kind,
									fromLine: index + 1,
									toLine: index + 1
								}
							];
						}
					}
						if (!controlHeaderWithoutInlineBlock) {
							for (const [name, container] of currentFunctionContainers) {
								if (declaredContainerNames.has(name)) continue;
								const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
								if (!new RegExp(`\\b${escapedName}\\b`).test(normalized)) continue;
								trailingInstrumentation.push(
									`${indent}__wasm_idle_debug_emit_${container.container}(${currentFunctionId}, ${container.slot}, ${name});`
								);
							}
							for (const [name, variable] of currentFunctionVariables) {
								const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
							if (normalized.startsWith('for') && variable.toLine === index + 1) continue;
							if (
								new RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${escapedName}\\b`).test(normalized) ||
								new RegExp(`\\b${escapedName}\\s*(?:[+\\-*/%]?=|\\+\\+|--)`).test(normalized) ||
								new RegExp(`&\\s*${escapedName}\\b`).test(normalized)
							) {
								trailingInstrumentation.push(
									`${indent}${variable.kind === 'bool' ? '__wasm_idle_debug_value_bool' : '__wasm_idle_debug_value_num'}(${currentFunctionId}, ${variable.slot}, ${name});`
								);
							}
						}
					}
					if (/^return\b/.test(normalized))
						leadingInstrumentation.push(`${indent}__wasm_idle_debug_leave(${currentFunctionId});`);
				}
				if (functionDepth > 0 && braceDepth === functionDepth && normalized === '}') {
					leadingInstrumentation.push(`${indent}__wasm_idle_debug_leave(${currentFunctionId});`);
				}
				if (
					inFunctionBody &&
					currentFunctionId &&
					(/^(while|if)\s*\(/.test(normalized) || /^for\s*\(/.test(normalized))
				) {
					const keywordMatch = normalized.match(/^(while|if|for)\b/);
					const keyword = keywordMatch?.[1];
					const keywordIndex = line.indexOf(keyword || '');
					const openIndex = keywordIndex >= 0 ? line.indexOf('(', keywordIndex) : -1;
					if (openIndex >= 0) {
						let closeIndex = -1;
						let parenDepth = 0;
						for (let cursor = openIndex; cursor < line.length; cursor += 1) {
							const character = line[cursor];
							if (character === '(') parenDepth += 1;
							if (character === ')') {
								parenDepth -= 1;
								if (parenDepth === 0) {
									closeIndex = cursor;
									break;
								}
							}
							for (const [name, variable] of globalVariables) {
								if (currentFunctionVariables.has(name) || currentFunctionContainers.has(name)) continue;
								const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
								if (
									new RegExp(`(?:^|[^\\w])(?:\\+\\+|--)\\s*${escapedName}\\b`).test(normalized) ||
									new RegExp(`\\b${escapedName}\\s*(?:[+\\-*/%]?=|\\+\\+|--)`).test(normalized) ||
									new RegExp(`&\\s*${escapedName}\\b`).test(normalized)
								) {
									trailingInstrumentation.push(
										`${indent}${variable.kind === 'bool' ? '__wasm_idle_debug_value_bool' : '__wasm_idle_debug_value_num'}(0, ${variable.slot}, ${name});`
									);
								}
							}
						}
						if (closeIndex > openIndex) {
							const conditionSource = line.slice(openIndex + 1, closeIndex);
							if (keyword === 'for') {
								const segments: string[] = [];
								let segmentBuffer = '';
								let segmentDepth = 0;
								for (const character of conditionSource) {
									if (character === ';' && segmentDepth === 0) {
										segments.push(segmentBuffer);
										segmentBuffer = '';
										continue;
									}
									if (character === '(') segmentDepth += 1;
									if (character === ')') segmentDepth = Math.max(0, segmentDepth - 1);
									segmentBuffer += character;
								}
								segments.push(segmentBuffer);
								if (segments.length === 3 && segments[1]?.trim()) {
									const initSource = segments[0].trim();
									const updateSource = segments[2].trim();
									const initHooks: string[] = [];
									const updateHooks: string[] = [];
									const initLooksLikeDeclaration =
										/^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:(?:short|long long|long)\s+)?(?:int|float|double|bool|char)\b/.test(
											initSource
										);
									for (const [name, variable] of currentFunctionVariables) {
										const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
										const mutationPattern = new RegExp(
											`(?:^|[^\\w])(?:\\+\\+|--)\\s*${escapedName}\\b|\\b${escapedName}\\s*(?:[+\\-*/%]?=|\\+\\+|--)`
										);
										if (!initLooksLikeDeclaration && mutationPattern.test(initSource)) {
											initHooks.push(
												`${variable.kind === 'bool' ? '__wasm_idle_debug_value_bool' : '__wasm_idle_debug_value_num'}(${currentFunctionId}, ${variable.slot}, ${name})`
											);
										}
										if (mutationPattern.test(updateSource)) {
											updateHooks.push(
												`${variable.kind === 'bool' ? '__wasm_idle_debug_value_bool' : '__wasm_idle_debug_value_num'}(${currentFunctionId}, ${variable.slot}, ${name})`
											);
										}
									}
									const instrumentedInit =
										initHooks.length && initSource
											? `(${initSource}, ${initHooks.join(', ')})`
											: segments[0];
									const instrumentedUpdate =
										updateHooks.length && updateSource
											? `(${updateSource}, ${updateHooks.join(', ')})`
											: segments[2];
									rewrittenLine =
										line.slice(0, openIndex + 1) +
										`${instrumentedInit}; (__wasm_idle_debug_line(${currentFunctionId}, ${index + 1}), (${segments[1].trim()})); ${instrumentedUpdate}` +
										line.slice(closeIndex);
								}
							} else {
								rewrittenLine =
									line.slice(0, openIndex + 1) +
									`(__wasm_idle_debug_line(${currentFunctionId}, ${index + 1}), (${conditionSource.trim()}))` +
									line.slice(closeIndex);
							}
						}
					}
				}
				instrumented.push(...leadingInstrumentation);
				instrumented.push(rewrittenLine);
				instrumented.push(...trailingInstrumentation);
				const startsInlineFunctionBody =
					functionDepth === 0 &&
					normalized.includes('(') &&
					normalized.includes(')') &&
					normalized.includes('{') &&
					!/^(if|for|while|switch|catch)\b/.test(normalized) &&
					!/^(class|struct|namespace|enum|union)\b/.test(normalized);
				const startsPendingFunctionBody =
					functionDepth === 0 && !!pendingFunctionHeader && normalized === '{';
				braceDepth += (analysisLine.match(/{/g) || []).length;
				braceDepth -= (analysisLine.match(/}/g) || []).length;
				if (startsInlineFunctionBody || startsPendingFunctionBody) {
					functionDepth = braceDepth;
					currentFunctionId = nextFunctionId++;
					let functionName = 'anonymous';
					if (startsInlineFunctionBody) {
						const beforeParen = normalized.slice(0, normalized.indexOf('(')).trim();
						functionName = beforeParen.split(/\s+/).pop() || functionName;
					} else if (pendingFunctionHeader) {
						functionName = pendingFunctionHeader.functionName || functionName;
					}
					this.debugFunctionMetadata[currentFunctionId] = functionName;
					nextVariableSlot = 1;
					currentFunctionVariables = new Map();
					currentFunctionContainers = new Map();
					instrumented.push(`${indent}    __wasm_idle_debug_enter(${currentFunctionId});`);
					const parameterSource = startsInlineFunctionBody
						? normalized.slice(normalized.indexOf('(') + 1, normalized.lastIndexOf(')'))
						: pendingFunctionHeader?.parameters || '';
					for (const parameter of parameterSource
						.split(',')
						.map((value: string) => value.trim())
						.filter(Boolean)) {
						const cleaned = parameter.split('=')[0]?.trim() || '';
						const containerParameterMatch = cleaned.match(
							/^(?:const\s+)?(?:(?:std::)?(vector|set|map)\s*<.+>)\s*&?\s*([A-Za-z_]\w*)\s*$/
						);
						if (containerParameterMatch) {
							const slot = nextVariableSlot++;
							const container = containerParameterMatch[1] as 'vector' | 'set' | 'map';
							const name = containerParameterMatch[2];
							currentFunctionContainers.set(name, {
								slot,
								container,
								fromLine: index + 1,
								toLine: Number.MAX_SAFE_INTEGER
							});
							this.debugVariableMetadata[currentFunctionId] = [
								...(this.debugVariableMetadata[currentFunctionId] || []),
								{
									slot,
									name,
									kind: 'text',
									fromLine: index + 1,
									toLine: Number.MAX_SAFE_INTEGER
								}
							];
							instrumented.push(
								`${indent}    __wasm_idle_debug_emit_${container}(${currentFunctionId}, ${slot}, ${name});`
							);
							continue;
						}
						const parameterArrayDimensions: number[] = [];
						for (const match of cleaned.matchAll(/\[(\d+)\]/g)) {
							parameterArrayDimensions.push(Number(match[1]));
						}
						const parameterArrayName = cleaned.match(/([A-Za-z_]\w*)\s*(?=\[\d+\])/);
						if (
							parameterArrayDimensions.length &&
							parameterArrayName &&
							/\b(int|float|double|bool|char)\b/.test(cleaned)
						) {
							const slot = nextVariableSlot++;
							this.debugVariableMetadata[currentFunctionId] = [
								...(this.debugVariableMetadata[currentFunctionId] || []),
								{
									slot,
									name: parameterArrayName[1],
									kind: 'array',
									elementKind: (cleaned.match(/\b(int|float|double|bool|char)\b/)?.[1] || 'int') as DebugArrayElementKind,
									length: parameterArrayDimensions[0],
									dimensions: parameterArrayDimensions,
									fromLine: index + 1,
									toLine: Number.MAX_SAFE_INTEGER
								}
							];
							instrumented.push(
								`${indent}    __wasm_idle_debug_value_addr(${currentFunctionId}, ${slot}, (int)((unsigned long long)(${parameterArrayName[1]})));`
							);
							continue;
						}
						if (/[*&\[]/.test(cleaned)) continue;
						const nameMatch = cleaned.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);
						if (!nameMatch) continue;
						const name = nameMatch[1];
						const kind =
							/\bbool\b/.test(cleaned) ? 'bool' : /\b(?:int|float|double|char|short|long)\b/.test(cleaned)
								? 'number'
								: '';
						if (!kind) continue;
						const slot = nextVariableSlot++;
						currentFunctionVariables.set(name, {
							slot,
							kind,
							fromLine: index + 1,
							toLine: Number.MAX_SAFE_INTEGER
						});
						this.debugVariableMetadata[currentFunctionId] = [
							...(this.debugVariableMetadata[currentFunctionId] || []),
							{
								slot,
								name,
								kind,
								fromLine: index + 1,
								toLine: Number.MAX_SAFE_INTEGER
							}
						];
						instrumented.push(
							`${indent}    ${kind === 'bool' ? '__wasm_idle_debug_value_bool' : '__wasm_idle_debug_value_num'}(${currentFunctionId}, ${slot}, ${name});`
						);
					}
					pendingFunctionHeader = undefined;
				} else if (
					functionDepth === 0 &&
					normalized.includes('(') &&
					normalized.includes(')') &&
					!normalized.includes('{') &&
					!normalized.endsWith(';') &&
					!/^(if|for|while|switch|catch)\b/.test(normalized) &&
					!/^(class|struct|namespace|enum|union)\b/.test(normalized)
				) {
					const beforeParen = normalized.slice(0, normalized.indexOf('(')).trim();
					pendingFunctionHeader = {
						functionName: beforeParen.split(/\s+/).pop() || 'anonymous',
						parameters: normalized.slice(normalized.indexOf('(') + 1, normalized.lastIndexOf(')'))
					};
				} else if (normalized && normalized !== '{') {
					pendingFunctionHeader = undefined;
				}
				if (functionDepth > 0 && braceDepth < functionDepth) {
					functionDepth = 0;
						currentFunctionId = 0;
						currentFunctionVariables = new Map();
						currentFunctionContainers = new Map();
					}
			}
			if (globalInitialization.length) {
				instrumented.push('struct __wasm_idle_debug_globals_init {');
				instrumented.push('    __wasm_idle_debug_globals_init() {');
				instrumented.push(...globalInitialization.map((line) => `        ${line}`));
				instrumented.push('    }');
				instrumented.push('} __wasm_idle_debug_globals_init_instance;');
			}
			source = instrumented.join('\n');
		} else {
			this.debugVariableMetadata = {};
			this.debugGlobalMetadata = [];
		}
		const code = toUtf8(source);

		await this.ready;
		this.memfs.addFile(input, code);
		const clang = await this.getModule(clangUrl(this.path));
		const compilerArgs = [
			'-cc1',
			'-emit-obj',
			...clangCommonArgs,
			'-O' + opt,
			'-o',
			obj,
			clangLanguageStandardArg,
			'-x',
			'c++',
			input,
			...(options.args || [])
		];
		this.trace(`compile ${input} -> ${obj}`);
		return await this.run(
			clang,
			true,
			'clang',
			...compilerArgs
		);
	}

	async link(obj: string, wasm: string, debug = false) {
		const stackSize = 1024 * 1024;
		const libdir = 'lib/wasm32-wasi';
		const crt1 = `${libdir}/crt1.o`;
		await this.ready;
		const lld = await this.getModule(lldUrl(this.path));
		this.trace(`link ${obj} -> ${wasm}`);
		return await this.run(
			lld,
			this.log,
			'wasm-ld',
			'--no-threads',
			'--export-dynamic', // TODO required?
			...(debug ? ['--allow-undefined'] : []),
			'-z',
			`stack-size=${stackSize}`,
			`-L${libdir}`,
			crt1,
			obj,
			'-lc',
			'-lc++',
			'-lc++abi',
			'-lm',
			`-Llib/clang/8.0.1/lib/wasi`,
			'-lclang_rt.builtins-wasm32',
			'-o',
			wasm
		);
	}

	async run(module: WebAssembly.Module, out: boolean, ...args: string[]) {
		this.memfs.out = out;
		this.hostLog(`${args.join(' ')}\n`);
		this.trace(`run ${args.join(' ')}`);
		const start = +new Date();
		const app = new App(module, this.memfs, args[0], ...args.slice(1));
		app.trace = (message) => this.trace(message);
			app.debugSession = {
				buffer: this.debugBuffer,
				interruptBuffer: this.debugInterruptBuffer,
				breakpoints: new Set(this.debugBreakpoints),
				pauseOnEntry: this.debugPauseOnEntry,
				stepArmed: this.debugPauseOnEntry,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 0,
				stepOutDepth: 0,
				currentFunctionId: 0,
				currentLine: 0,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				variableMetadata: this.debugVariableMetadata,
				globalVariableMetadata: this.debugGlobalMetadata,
				functionMetadata: this.debugFunctionMetadata,
				frames: [],
				globalValues: new Map(),
				onPause: (event) => this.onDebugEvent?.(event)
			};
		const instantiate = +new Date();
		const stillRunning = await app.run();
		const end = +new Date();
		if (this.log) this.stdout('\n');
		if (this.showTiming)
			this.stdout(`${green}(${start - instantiate}ms/${end - instantiate}ms)${normal}\n`);
		return stillRunning ? app : null;
	}

	async compileLink(code: string, options: DebugRunOptions = {}) {
		const {
			args = [],
			debug = false,
			breakpoints = [],
			pauseOnEntry = false,
			debugBuffer,
			interruptBuffer
		} = options;
		const input = `test.cc`,
			obj = `test.o`,
			wasm = `test.wasm`;
		this.beginTrace(debug);
		this.debugBreakpoints = new Set(debug ? breakpoints : []);
		this.debugPauseOnEntry = debug && pauseOnEntry;
		this.debugBuffer = debugBuffer;
		this.debugInterruptBuffer = interruptBuffer;
		const buildKey = JSON.stringify({ code, args, debug });
		if (this.lastBuildKey === buildKey) {
			this.trace(`reuse ${wasm}`);
			return this.wasm;
		}
		await this.compile({ input, code, obj, args, debug });
		await this.link(obj, wasm, debug);

		this.lastBuildKey = buildKey;
		const wasmBytes = Uint8Array.from(this.memfs.getFileContents(wasm));
		return (this.wasm = await this.hostLogAsync(
			`Compiling ${wasm}`,
			WebAssembly.compile(wasmBytes)
		));
	}

	async compileLinkRun(code: string, options: DebugRunOptions = {}) {
		const {
			args = [],
			debug = false,
			breakpoints = [],
			pauseOnEntry = false,
			debugBuffer,
			interruptBuffer
		} = options;
		this.debug = debug;
		return await this.run(
			await this.compileLink(code, {
				args,
				debug,
				breakpoints,
				pauseOnEntry,
				debugBuffer,
				interruptBuffer
			}),
			true,
			`test.wasm`
		);
	}
}
