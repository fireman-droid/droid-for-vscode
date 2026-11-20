import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBackoff } from './kilo/ErrorBackoff';
import { calcDebounceDelay } from './kilo/inline-utils';
import { FimCompletionError } from '../../runtime/autocomplete/completionTransport';

afterEach(() => vi.useRealTimers());
describe('Kilo completion history and scheduling', () => {
  it('adapts latency while bounding the typing delay', () => {
    expect(calcDebounceDelay([])).toBe(150);
    expect(calcDebounceDelay([200, 400])).toBe(300);
    expect(calcDebounceDelay([9000])).toBe(1000);
  });
  it('stops authentication failures until reset and backs off repeated service failures', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const b = new ErrorBackoff();
    b.failure(new FimCompletionError('http','safe',401)); vi.advanceTimersByTime(999_999);
    expect(b.blocked()).toBe(true); b.reset(); expect(b.blocked()).toBe(false);
    b.failure(new FimCompletionError('network','safe')); expect(b.blocked()).toBe(true);
    vi.advanceTimersByTime(2000); expect(b.blocked()).toBe(false);
    b.failure(new FimCompletionError('http','safe',429)); vi.advanceTimersByTime(3999);
    expect(b.blocked()).toBe(true); vi.advanceTimersByTime(1); expect(b.blocked()).toBe(false);
    b.success(); expect(b.blocked()).toBe(false);
  });
});
