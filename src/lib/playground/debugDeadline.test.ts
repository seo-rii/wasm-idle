// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { DebugDeadline } from './debugDeadline';

afterEach(() => vi.useRealTimers());
it('charges only running time and cannot restart after disposal', () => {
	vi.useFakeTimers();
	const expire = vi.fn();
	const deadline = new DebugDeadline(1000, expire);
	vi.advanceTimersByTime(400);
	deadline.pause();
	vi.advanceTimersByTime(60_000);
	expect(expire).not.toHaveBeenCalled();
	deadline.resume();
	vi.advanceTimersByTime(599);
	expect(expire).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(expire).toHaveBeenCalledOnce();
	deadline.dispose();
	deadline.resume();
	vi.advanceTimersByTime(1000);
	expect(expire).toHaveBeenCalledOnce();
});
