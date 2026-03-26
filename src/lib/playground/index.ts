import Clang from '$lib/playground/clang';
import Java from '$lib/playground/java';
import Python from '$lib/playground/python';
import Rust from '$lib/playground/rust';
import type {
	BoundSandbox,
	PlaygroundBinding,
	Sandbox,
	SandboxProgress,
	SandboxRuntimeAssets
} from '$lib/playground/sandbox';
import type { SandboxExecutionOptions } from '$lib/playground/options';

const sandboxCache: { [key: string]: Sandbox } = {};

export const supportedLanguages = ['PYTHON3', 'PYPY3', 'C', 'CPP', 'JAVA', 'RUST'];

function bindRuntimeAssets(sandbox: Sandbox, runtimeAssets: SandboxRuntimeAssets): BoundSandbox {
	return new Proxy(sandbox, {
		get(target, prop, receiver) {
			if (prop === 'runtimeAssets') return runtimeAssets;
			if (prop === 'load') {
				return (
					code = '',
					log = true,
					args: string[] = [],
					options: SandboxExecutionOptions = {},
					progress?: SandboxProgress
				) => target.load(runtimeAssets, code, log, args, options, progress);
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		set(target, prop, value, receiver) {
			return Reflect.set(target, prop, value, receiver);
		}
	}) as BoundSandbox;
}

export function createPlaygroundBinding(runtimeAssets: SandboxRuntimeAssets): PlaygroundBinding {
	const binding = {
		runtimeAssets,
		terminalProps: {} as PlaygroundBinding['terminalProps'],
		async load(language: string) {
			return bindRuntimeAssets(await playground(language), runtimeAssets);
		}
	} as PlaygroundBinding;
	binding.terminalProps = {
		playground: binding,
		runtimeAssets
	};
	return binding;
}

async function playground(language: string): Promise<Sandbox>;
async function playground(
	language: string,
	runtimeAssets: SandboxRuntimeAssets
): Promise<BoundSandbox>;
async function playground(language: string, runtimeAssets?: SandboxRuntimeAssets) {
	if (sandboxCache[language]) {
		return runtimeAssets
			? bindRuntimeAssets(sandboxCache[language], runtimeAssets)
			: sandboxCache[language];
	}
	let sandbox;
	switch (language) {
		case 'PYTHON3':
		case 'PYTHON':
		case 'PYPY3':
			sandbox = new Python();
			break;
		case 'C':
			sandbox = new Clang('C');
			break;
		case 'CPP':
			sandbox = new Clang('CPP');
			break;
		case 'JAVA':
			sandbox = new Java();
			break;
		case 'RUST':
			sandbox = new Rust();
			break;
		default:
			throw new Error(`Unsupported language: ${language}`);
	}
	sandboxCache[language] = sandbox;
	if (sandbox) {
		if (language === 'PYTHON3') sandboxCache['PYPY3'] = sandboxCache['PYTHON'] = sandbox;
		if (language === 'PYTHON') sandboxCache['PYTHON3'] = sandboxCache['PYPY3'] = sandbox;
		if (language === 'PYPY3') sandboxCache['PYTHON3'] = sandboxCache['PYTHON'] = sandbox;
		if (language === 'C') sandboxCache['C'] = sandbox;
		if (language === 'CPP') sandboxCache['CPP'] = sandbox;
		if (language === 'JAVA') sandboxCache['JAVA'] = sandbox;
		if (language === 'RUST') sandboxCache['RUST'] = sandbox;
	}
	return runtimeAssets ? bindRuntimeAssets(sandbox, runtimeAssets) : sandbox;
}

export default playground;
