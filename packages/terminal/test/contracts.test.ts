import type {
	PlaygroundBinding as CorePlaygroundBinding,
	TerminalControl as CoreTerminalControl
} from '@wasm-idle/core';
import type { PlaygroundBinding, TerminalControl } from '../src/index.js';
import { expectTypeOf, it } from 'vitest';

it('accepts core playground and terminal contracts', () => {
	expectTypeOf<CorePlaygroundBinding>().toExtend<PlaygroundBinding>();
	expectTypeOf<TerminalControl>().toExtend<CoreTerminalControl>();
});
