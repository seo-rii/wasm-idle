// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
	DEFAULT_GO_BROWSER_EXPECTED_OUTPUT,
	hasGoExecutionPhaseCompleted
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
});
