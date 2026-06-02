package org.teavm.classlib.java.util.concurrent.atomic;

import java.util.Arrays;
import java.util.function.IntBinaryOperator;
import java.util.function.IntUnaryOperator;
import org.teavm.classlib.java.io.TSerializable;

public class TAtomicIntegerArray implements TSerializable {
    private final int[] array;

    public TAtomicIntegerArray(int length) {
        array = new int[length];
    }

    public TAtomicIntegerArray(int[] array) {
        this.array = array.clone();
    }

    public final int length() {
        return array.length;
    }

    public final int get(int index) {
        return array[index];
    }

    public final void set(int index, int value) {
        array[index] = value;
    }

    public final void lazySet(int index, int value) {
        set(index, value);
    }

    public final int getAndSet(int index, int value) {
        var previous = get(index);
        set(index, value);
        return previous;
    }

    public final boolean compareAndSet(int index, int expect, int update) {
        if (get(index) == expect) {
            set(index, update);
            return true;
        }
        return false;
    }

    public final boolean weakCompareAndSet(int index, int expect, int update) {
        return compareAndSet(index, expect, update);
    }

    public final boolean weakCompareAndSetPlain(int index, int expect, int update) {
        return compareAndSet(index, expect, update);
    }

    public final int getAndIncrement(int index) {
        return getAndAdd(index, 1);
    }

    public final int getAndDecrement(int index) {
        return getAndAdd(index, -1);
    }

    public final int getAndAdd(int index, int delta) {
        var previous = get(index);
        set(index, previous + delta);
        return previous;
    }

    public final int incrementAndGet(int index) {
        return addAndGet(index, 1);
    }

    public final int decrementAndGet(int index) {
        return addAndGet(index, -1);
    }

    public final int addAndGet(int index, int delta) {
        var updated = get(index) + delta;
        set(index, updated);
        return updated;
    }

    public final int getAndUpdate(int index, IntUnaryOperator updateFunction) {
        var previous = get(index);
        set(index, updateFunction.applyAsInt(previous));
        return previous;
    }

    public final int updateAndGet(int index, IntUnaryOperator updateFunction) {
        var updated = updateFunction.applyAsInt(get(index));
        set(index, updated);
        return updated;
    }

    public final int getAndAccumulate(int index, int value, IntBinaryOperator accumulatorFunction) {
        var previous = get(index);
        set(index, accumulatorFunction.applyAsInt(previous, value));
        return previous;
    }

    public final int accumulateAndGet(int index, int value, IntBinaryOperator accumulatorFunction) {
        var updated = accumulatorFunction.applyAsInt(get(index), value);
        set(index, updated);
        return updated;
    }

    @Override
    public String toString() {
        return Arrays.toString(array);
    }
}
