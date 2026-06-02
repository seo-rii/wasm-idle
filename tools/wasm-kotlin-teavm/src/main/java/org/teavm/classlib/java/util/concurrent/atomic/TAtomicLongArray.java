package org.teavm.classlib.java.util.concurrent.atomic;

import java.util.Arrays;
import java.util.function.LongBinaryOperator;
import java.util.function.LongUnaryOperator;
import org.teavm.classlib.java.io.TSerializable;

public class TAtomicLongArray implements TSerializable {
    private final long[] array;

    public TAtomicLongArray(int length) {
        array = new long[length];
    }

    public TAtomicLongArray(long[] array) {
        this.array = array.clone();
    }

    public final int length() {
        return array.length;
    }

    public final long get(int index) {
        return array[index];
    }

    public final void set(int index, long value) {
        array[index] = value;
    }

    public final void lazySet(int index, long value) {
        set(index, value);
    }

    public final long getAndSet(int index, long value) {
        var previous = get(index);
        set(index, value);
        return previous;
    }

    public final boolean compareAndSet(int index, long expect, long update) {
        if (get(index) == expect) {
            set(index, update);
            return true;
        }
        return false;
    }

    public final boolean weakCompareAndSet(int index, long expect, long update) {
        return compareAndSet(index, expect, update);
    }

    public final boolean weakCompareAndSetPlain(int index, long expect, long update) {
        return compareAndSet(index, expect, update);
    }

    public final long getAndIncrement(int index) {
        return getAndAdd(index, 1);
    }

    public final long getAndDecrement(int index) {
        return getAndAdd(index, -1);
    }

    public final long getAndAdd(int index, long delta) {
        var previous = get(index);
        set(index, previous + delta);
        return previous;
    }

    public final long incrementAndGet(int index) {
        return addAndGet(index, 1);
    }

    public final long decrementAndGet(int index) {
        return addAndGet(index, -1);
    }

    public final long addAndGet(int index, long delta) {
        var updated = get(index) + delta;
        set(index, updated);
        return updated;
    }

    public final long getAndUpdate(int index, LongUnaryOperator updateFunction) {
        var previous = get(index);
        set(index, updateFunction.applyAsLong(previous));
        return previous;
    }

    public final long updateAndGet(int index, LongUnaryOperator updateFunction) {
        var updated = updateFunction.applyAsLong(get(index));
        set(index, updated);
        return updated;
    }

    public final long getAndAccumulate(int index, long value, LongBinaryOperator accumulatorFunction) {
        var previous = get(index);
        set(index, accumulatorFunction.applyAsLong(previous, value));
        return previous;
    }

    public final long accumulateAndGet(int index, long value, LongBinaryOperator accumulatorFunction) {
        var updated = accumulatorFunction.applyAsLong(get(index), value);
        set(index, updated);
        return updated;
    }

    @Override
    public String toString() {
        return Arrays.toString(array);
    }
}
