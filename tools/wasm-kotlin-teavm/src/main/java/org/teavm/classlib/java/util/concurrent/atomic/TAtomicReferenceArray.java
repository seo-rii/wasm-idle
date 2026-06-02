package org.teavm.classlib.java.util.concurrent.atomic;

import java.util.Arrays;
import java.util.function.BinaryOperator;
import java.util.function.UnaryOperator;
import org.teavm.classlib.java.io.TSerializable;

public class TAtomicReferenceArray<E> implements TSerializable {
    private final Object[] array;

    public TAtomicReferenceArray(int length) {
        array = new Object[length];
    }

    public TAtomicReferenceArray(E[] array) {
        this.array = array.clone();
    }

    public final int length() {
        return array.length;
    }

    @SuppressWarnings("unchecked")
    public final E get(int index) {
        return (E) array[index];
    }

    public final void set(int index, E value) {
        array[index] = value;
    }

    public final void lazySet(int index, E value) {
        set(index, value);
    }

    public final E getAndSet(int index, E value) {
        E previous = get(index);
        set(index, value);
        return previous;
    }

    public final boolean compareAndSet(int index, E expect, E update) {
        if (get(index) == expect) {
            set(index, update);
            return true;
        }
        return false;
    }

    public final boolean weakCompareAndSet(int index, E expect, E update) {
        return compareAndSet(index, expect, update);
    }

    public final boolean weakCompareAndSetPlain(int index, E expect, E update) {
        return compareAndSet(index, expect, update);
    }

    public final E getAndUpdate(int index, UnaryOperator<E> updateFunction) {
        E previous = get(index);
        set(index, updateFunction.apply(previous));
        return previous;
    }

    public final E updateAndGet(int index, UnaryOperator<E> updateFunction) {
        E updated = updateFunction.apply(get(index));
        set(index, updated);
        return updated;
    }

    public final E getAndAccumulate(int index, E value, BinaryOperator<E> accumulatorFunction) {
        E previous = get(index);
        set(index, accumulatorFunction.apply(previous, value));
        return previous;
    }

    public final E accumulateAndGet(int index, E value, BinaryOperator<E> accumulatorFunction) {
        E updated = accumulatorFunction.apply(get(index), value);
        set(index, updated);
        return updated;
    }

    @Override
    public String toString() {
        return Arrays.toString(array);
    }
}
