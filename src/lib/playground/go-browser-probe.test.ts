// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_GO_BROWSER_EXPECTED_OUTPUT,
	hasGoExecutionPhaseCompleted,
	isGoEditorStateReady,
	waitForStableGoEditorSource
} from '../../../scripts/go-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

describe('Go browser probe completion', () => {
	beforeEach(() => {
		document.body.innerHTML = '<div data-testid="terminal-debug-output"></div>';
	});

	it('matches the default Go starter output', () => {
		expect(DEFAULT_GO_BROWSER_EXPECTED_OUTPUT).toBe('fibonacci=11');
		expect(editorDefaults.go).toContain('fmt.Printf("fibonacci=%d\\n", fibonacci(n)+bonus)');
	});

	it('recognizes a finished execution independently of its expected output assertion', () => {
		const transcript = document.querySelector('[data-testid="terminal-debug-output"]');
		expect(transcript).not.toBeNull();
		transcript!.textContent = 'fibonacci=11\n\nProcess finished after 146ms';

		expect(
			hasGoExecutionPhaseCompleted({
				previousTranscript: '',
				previousFinishedCount: 0
			})
		).toBe(true);
	});

	it('keeps waiting until a new execution finishes', () => {
		const transcript = document.querySelector('[data-testid="terminal-debug-output"]');
		expect(transcript).not.toBeNull();
		transcript!.textContent = 'fibonacci=11';

		expect(
			hasGoExecutionPhaseCompleted({
				previousTranscript: '',
				previousFinishedCount: 0
			})
		).toBe(false);
	});

	it('stops waiting when compilation fails', () => {
		const transcript = document.querySelector('[data-testid="terminal-debug-output"]');
		expect(transcript).not.toBeNull();
		transcript!.textContent = 'Go compilation failed: invalid syntax';

		expect(
			hasGoExecutionPhaseCompleted({
				previousTranscript: '',
				previousFinishedCount: 0
			})
		).toBe(true);
	});

	it('only accepts a ready Go editor API containing a package main source', () => {
		expect(
			isGoEditorStateReady({
				editorApiReady: true,
				language: 'GO',
				source: editorDefaults.go
			})
		).toBe(true);
		expect(
			isGoEditorStateReady({
				editorApiReady: false,
				language: 'GO',
				source: editorDefaults.go
			})
		).toBe(false);
		expect(
			isGoEditorStateReady({
				editorApiReady: true,
				language: 'CPP',
				source: editorDefaults.go
			})
		).toBe(false);
		expect(
			isGoEditorStateReady({
				editorApiReady: true,
				language: 'GO',
				source: '#include <stdio.h>'
			})
		).toBe(false);
	});

	it('waits for the Go source to remain stable across consecutive editor reads', async () => {
		const readyState = {
			editorApiReady: true,
			language: 'GO',
			source: editorDefaults.go
		};
		const states = [
			{ editorApiReady: false, language: 'GO', source: '' },
			{ editorApiReady: true, language: 'GO', source: '' },
			{ editorApiReady: true, language: 'GO', source: 'package main\n// incomplete' },
			readyState,
			readyState,
			readyState
		];
		const selectOption = vi.fn(async () => []);
		const page = {
			evaluate: vi.fn(async () => states.shift() ?? readyState),
			locator: vi.fn(() => ({ selectOption })),
			waitForTimeout: vi.fn(async () => {})
		};

		await expect(waitForStableGoEditorSource(page as any, 1_000)).resolves.toBe(
			editorDefaults.go
		);
		expect(page.evaluate).toHaveBeenCalledTimes(6);
		expect(page.waitForTimeout).toHaveBeenCalledTimes(5);
		expect(selectOption).toHaveBeenCalledOnce();
	});

	it('retries navigation and restores Go selection before checking stability', async () => {
		const readyState = {
			editorApiReady: true,
			language: 'GO',
			source: editorDefaults.go
		};
		const evaluate = vi
			.fn()
			.mockRejectedValueOnce(new Error('Execution context was destroyed'))
			.mockResolvedValueOnce({
				editorApiReady: true,
				language: 'CPP',
				source: '#include <stdio.h>'
			})
			.mockResolvedValue(readyState);
		const selectOption = vi.fn(async () => []);
		const page = {
			evaluate,
			locator: vi.fn(() => ({ selectOption })),
			waitForTimeout: vi.fn(async () => {})
		};

		await expect(waitForStableGoEditorSource(page as any, 1_000)).resolves.toBe(
			editorDefaults.go
		);
		expect(evaluate).toHaveBeenCalledTimes(5);
		expect(page.locator).toHaveBeenCalledWith('#language-select');
		expect(selectOption).toHaveBeenCalledWith('GO', { timeout: expect.any(Number) });
	});

	it('selects Go and waits for its editor source before running', async () => {
		const source = await readFile('scripts/go-browser-probe-lib.mjs', 'utf8');
		const selectIndex = source.indexOf("page.locator('#language-select').selectOption('GO')");
		const editorReadyIndex = source.indexOf(
			'await waitForStableGoEditorSource(page, editorReadyTimeoutMs)'
		);
		const runIndex = source.indexOf(
			"page.locator('button.action-button--run').first().click()",
			editorReadyIndex
		);

		expect(selectIndex).toBeGreaterThan(-1);
		expect(editorReadyIndex).toBeGreaterThan(selectIndex);
		expect(runIndex).toBeGreaterThan(editorReadyIndex);
		expect(source).toContain('await page.evaluate(() => localStorage.clear())');
		expect(source).toContain('const editorReadyTimeoutMs = Math.min(runTimeoutMs, 30_000)');
		expect(source).not.toMatch(/(?:locator|waitForSelector)\('select'/u);
	});
});
