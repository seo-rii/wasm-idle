#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SWIFT_RUNTIME_CONTRACT_VERSION = 2;
export const SWIFT_RUNTIME_CONTRACT_FORMAT = 'wasm-swift-runtime-contract-v1';
export const SWIFT_REQUIRED_WORKER_REQUEST_FIELDS = [
	'run',
	'baseUrl',
	'manifestUrl',
	'code',
	'stdin',
	'args',
	'activePath',
	'workspaceFiles'
];
export const SWIFT_REQUIRED_WORKER_RESPONSE_FIELDS = ['output', 'results', 'error', 'progress'];

export const SWIFT_RUNTIME_CONTRACT_CASES = [
	{
		name: 'stdin-readline',
		description: 'Runs a Swift program that reads one stdin line through readLine().',
		activePath: 'main.swift',
		code: `let line = readLine() ?? ""
print("swift-stdin:\\(line)")
`,
		stdin: 'hello wasm-idle\n',
		args: [],
		workspaceFiles: [],
		expectedStdout: 'swift-stdin:hello wasm-idle\n'
	},
	{
		name: 'stdin-multiline',
		description: 'Preserves multiple stdin lines across repeated readLine() calls.',
		activePath: 'main.swift',
		code: `let first = readLine() ?? ""
let second = readLine() ?? ""
print("swift-stdin-lines:\\(first)|\\(second)")
`,
		stdin: 'alpha\nbeta\n',
		args: [],
		workspaceFiles: [],
		expectedStdout: 'swift-stdin-lines:alpha|beta\n'
	},
	{
		name: 'program-arguments',
		description: 'Passes program arguments through CommandLine.arguments.',
		activePath: 'main.swift',
		code: `print(CommandLine.arguments.dropFirst().joined(separator: ","))
`,
		stdin: '',
		args: ['alpha', 'beta'],
		workspaceFiles: [],
		expectedStdout: 'alpha,beta\n'
	},
	{
		name: 'workspace-files',
		description: 'Compiles the active Swift source together with additional workspace files.',
		activePath: 'Sources/main.swift',
		code: `print(helper())
`,
		stdin: '',
		args: [],
		workspaceFiles: [
			{
				path: 'Sources/Helper.swift',
				content: `func helper() -> String {
	return "workspace-ok"
}
`
			}
		],
		expectedStdout: 'workspace-ok\n'
	},
	{
		name: 'compile-error',
		description: 'Reports a compiler error for invalid Swift source instead of succeeding.',
		activePath: 'main.swift',
		code: `let =
`,
		stdin: '',
		args: [],
		workspaceFiles: [],
		expectedStdout: '',
		expectError: true,
		expectedErrorPattern: 'Swift compiler failed'
	}
];

export function createSwiftRuntimeContract() {
	return {
		format: SWIFT_RUNTIME_CONTRACT_FORMAT,
		version: SWIFT_RUNTIME_CONTRACT_VERSION,
		requiredWorkerRequestFields: SWIFT_REQUIRED_WORKER_REQUEST_FIELDS,
		requiredWorkerResponseFields: SWIFT_REQUIRED_WORKER_RESPONSE_FIELDS,
		cases: SWIFT_RUNTIME_CONTRACT_CASES
	};
}

export function validateSwiftRuntimeContract(contract) {
	const errors = [];
	if (!contract || typeof contract !== 'object') return ['contract must be an object'];
	if (contract.format !== SWIFT_RUNTIME_CONTRACT_FORMAT) {
		errors.push(`format must be ${SWIFT_RUNTIME_CONTRACT_FORMAT}`);
	}
	if (contract.version !== SWIFT_RUNTIME_CONTRACT_VERSION) {
		errors.push(`version must be ${SWIFT_RUNTIME_CONTRACT_VERSION}`);
	}
	if (!Array.isArray(contract.requiredWorkerRequestFields)) {
		errors.push('requiredWorkerRequestFields must be an array');
	} else if (
		contract.requiredWorkerRequestFields.length !==
			SWIFT_REQUIRED_WORKER_REQUEST_FIELDS.length ||
		contract.requiredWorkerRequestFields.some(
			(field, index) => field !== SWIFT_REQUIRED_WORKER_REQUEST_FIELDS[index]
		)
	) {
		errors.push(
			`requiredWorkerRequestFields must exactly match ${SWIFT_REQUIRED_WORKER_REQUEST_FIELDS.join(', ')}`
		);
	}
	if (!Array.isArray(contract.requiredWorkerResponseFields)) {
		errors.push('requiredWorkerResponseFields must be an array');
	} else if (
		contract.requiredWorkerResponseFields.length !==
			SWIFT_REQUIRED_WORKER_RESPONSE_FIELDS.length ||
		contract.requiredWorkerResponseFields.some(
			(field, index) => field !== SWIFT_REQUIRED_WORKER_RESPONSE_FIELDS[index]
		)
	) {
		errors.push(
			`requiredWorkerResponseFields must exactly match ${SWIFT_REQUIRED_WORKER_RESPONSE_FIELDS.join(', ')}`
		);
	}
	if (!Array.isArray(contract.cases) || contract.cases.length === 0) {
		errors.push('cases must be a non-empty array');
		return errors;
	}
	const names = new Set();
	for (const [index, testCase] of contract.cases.entries()) {
		if (!testCase || typeof testCase !== 'object') {
			errors.push(`cases[${index}] must be an object`);
			continue;
		}
		if (typeof testCase.name !== 'string' || !/^[a-z0-9-]+$/u.test(testCase.name)) {
			errors.push(`cases[${index}].name must be a kebab-case string`);
		} else if (names.has(testCase.name)) {
			errors.push(`cases[${index}].name must be unique`);
		} else {
			names.add(testCase.name);
		}
		for (const field of ['description', 'code', 'stdin', 'expectedStdout']) {
			if (typeof testCase[field] !== 'string') {
				errors.push(`cases[${index}].${field} must be a string`);
			}
		}
		if ('expectError' in testCase && typeof testCase.expectError !== 'boolean') {
			errors.push(`cases[${index}].expectError must be a boolean when provided`);
		}
		if (
			'expectedErrorPattern' in testCase &&
			typeof testCase.expectedErrorPattern !== 'string'
		) {
			errors.push(`cases[${index}].expectedErrorPattern must be a string when provided`);
		} else if (typeof testCase.expectedErrorPattern === 'string') {
			try {
				new RegExp(testCase.expectedErrorPattern, 'u');
			} catch {
				errors.push(
					`cases[${index}].expectedErrorPattern must be a valid regular expression`
				);
			}
		}
		if (
			typeof testCase.activePath !== 'string' ||
			!testCase.activePath ||
			path.isAbsolute(testCase.activePath) ||
			path.win32.isAbsolute(testCase.activePath) ||
			testCase.activePath.split(/[\\/]+/u).includes('..')
		) {
			errors.push(`cases[${index}].activePath must be a relative project path`);
		}
		if (!Array.isArray(testCase.args)) {
			errors.push(`cases[${index}].args must be an array`);
		} else {
			for (const [argIndex, arg] of testCase.args.entries()) {
				if (typeof arg !== 'string') {
					errors.push(`cases[${index}].args[${argIndex}] must be a string`);
				}
			}
		}
		if (!Array.isArray(testCase.workspaceFiles)) {
			errors.push(`cases[${index}].workspaceFiles must be an array`);
			continue;
		}
		for (const [fileIndex, file] of testCase.workspaceFiles.entries()) {
			if (!file || typeof file !== 'object') {
				errors.push(`cases[${index}].workspaceFiles[${fileIndex}] must be an object`);
				continue;
			}
			if (
				typeof file.path !== 'string' ||
				!file.path ||
				path.isAbsolute(file.path) ||
				path.win32.isAbsolute(file.path) ||
				file.path.split(/[\\/]+/u).includes('..')
			) {
				errors.push(
					`cases[${index}].workspaceFiles[${fileIndex}].path must be a relative project path`
				);
			}
			if (typeof file.content !== 'string') {
				errors.push(
					`cases[${index}].workspaceFiles[${fileIndex}].content must be a string`
				);
			}
		}
	}
	return errors;
}

async function main() {
	const contract = createSwiftRuntimeContract();
	const errors = validateSwiftRuntimeContract(contract);
	if (errors.length > 0) {
		for (const error of errors) console.error(error);
		process.exitCode = 1;
		return;
	}
	console.log(JSON.stringify(contract, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	await main();
}
