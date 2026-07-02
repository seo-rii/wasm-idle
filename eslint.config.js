import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				...globals.worker
			}
		}
	},
	{
		files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.svelte.ts'],
		languageOptions: {
			parser: ts.parser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module'
			}
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser
			}
		}
	},
	{
		ignores: [
			'.DS_Store',
			'node_modules/',
			'.cache/',
			'build/',
			'.svelte-kit/',
			'package/',
			'dist/',
			'**/dist/',
			'coverage/',
			'.eslintrc.cjs',
			'.env',
			'.env.*',
			'pnpm-lock.yaml',
			'package-lock.json',
			'yarn.lock',
			'static/',
			'runtimes/*/dist/',
			'runtimes/*/node_modules/',
			'runtimes/wasm-clang/artifacts/',
			'runtimes/wasm-dotnet/dotnet/**/bin/',
			'runtimes/wasm-dotnet/dotnet/**/obj/',
			'runtimes/wasm-elixir/assets/',
			'runtimes/wasm-elixir/vendor/',
			'runtimes/wasm-of-js-of-ocaml/.cache/',
			'runtimes/wasm-of-js-of-ocaml/browser-harness/dist/',
			'runtimes/wasm-of-js-of-ocaml/dist/',
			'runtimes/wasm-of-js-of-ocaml/toolchain/',
			'runtimes/wasm-tinygo/public/vendor/',
			'tools/dool/',
			'**/RISK_REGISTER.md'
		]
	},
	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'no-control-regex': 'off',
			'no-async-promise-executor': 'off',
			'no-empty': 'off',
			'no-extra-boolean-cast': 'off',
			'no-misleading-character-class': 'off',
			'no-undef': 'off',
			'no-unused-vars': 'off',
			'no-useless-assignment': 'off',
			'no-useless-escape': 'off',
			'no-var': 'off',
			'prefer-const': 'off',
			'preserve-caught-error': 'off',
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
];
