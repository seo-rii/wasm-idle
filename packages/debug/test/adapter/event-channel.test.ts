import { describe, expect, it } from 'vitest';

import { createDebugAdapterEventChannel } from '../../src/adapter/event-channel.js';
import type { DebugAdapterEvent } from '../../src/adapter/types.js';

describe('debug adapter event channel', () => {
	it('delivers an event to later listeners before reporting the first listener failure', () => {
		const channel = createDebugAdapterEventChannel();
		const firstFailure = new Error('first listener failed');
		const observed: DebugAdapterEvent[] = [];
		channel.subscribe(() => {
			throw firstFailure;
		});
		channel.subscribe(() => {
			throw new Error('second listener failed');
		});
		channel.subscribe((event) => observed.push(event));
		const event = { type: 'stopped', reason: 'breakpoint', threadId: 1 } as const;

		expect(() => channel.emit(event)).toThrow(firstFailure);
		expect(observed).toEqual([event]);
	});

	it('skips a listener removed before its turn and defers a new listener', () => {
		const channel = createDebugAdapterEventChannel();
		const observed: string[] = [];
		let removePending = () => undefined;
		channel.subscribe(() => {
			removePending();
			channel.subscribe(() => observed.push('late'));
		});
		removePending = channel.subscribe(() => observed.push('removed'));
		channel.subscribe(() => observed.push('existing'));

		channel.emit({ type: 'initialized' });

		expect(observed).toEqual(['existing']);
	});
});
