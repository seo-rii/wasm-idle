#!/usr/bin/env node
export function createSwiftRuntimeContract(): {
	format: string;
	version: number;
	requiredWorkerRequestFields: string[];
	requiredWorkerResponseFields: string[];
	cases: (
		| {
				name: string;
				description: string;
				activePath: string;
				code: string;
				stdin: string;
				args: string[];
				workspaceFiles: never[];
				expectedStdout: string;
				expectError?: undefined;
				expectedErrorPattern?: undefined;
		  }
		| {
				name: string;
				description: string;
				activePath: string;
				code: string;
				stdin: string;
				args: never[];
				workspaceFiles: {
					path: string;
					content: string;
				}[];
				expectedStdout: string;
				expectError?: undefined;
				expectedErrorPattern?: undefined;
		  }
		| {
				name: string;
				description: string;
				activePath: string;
				code: string;
				stdin: string;
				args: never[];
				workspaceFiles: never[];
				expectedStdout: string;
				expectError: boolean;
				expectedErrorPattern: string;
		  }
	)[];
};
export function validateSwiftRuntimeContract(contract: any): string[];
export const SWIFT_RUNTIME_CONTRACT_VERSION: 2;
export const SWIFT_RUNTIME_CONTRACT_FORMAT: 'wasm-swift-runtime-contract-v1';
export const SWIFT_REQUIRED_WORKER_REQUEST_FIELDS: string[];
export const SWIFT_REQUIRED_WORKER_RESPONSE_FIELDS: string[];
export const SWIFT_RUNTIME_CONTRACT_CASES: (
	| {
			name: string;
			description: string;
			activePath: string;
			code: string;
			stdin: string;
			args: string[];
			workspaceFiles: never[];
			expectedStdout: string;
			expectError?: undefined;
			expectedErrorPattern?: undefined;
	  }
	| {
			name: string;
			description: string;
			activePath: string;
			code: string;
			stdin: string;
			args: never[];
			workspaceFiles: {
				path: string;
				content: string;
			}[];
			expectedStdout: string;
			expectError?: undefined;
			expectedErrorPattern?: undefined;
	  }
	| {
			name: string;
			description: string;
			activePath: string;
			code: string;
			stdin: string;
			args: never[];
			workspaceFiles: never[];
			expectedStdout: string;
			expectError: boolean;
			expectedErrorPattern: string;
	  }
)[];
