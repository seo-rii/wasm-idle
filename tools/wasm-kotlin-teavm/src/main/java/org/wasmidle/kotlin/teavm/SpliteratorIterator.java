package org.wasmidle.kotlin.teavm;

import java.util.Iterator;
import java.util.NoSuchElementException;
import java.util.Spliterator;
import java.util.function.Consumer;

public final class SpliteratorIterator<T> implements Iterator<T>, Consumer<T> {
    private final Spliterator<T> spliterator;
    private boolean scanned;
    private boolean available;
    private T next;

    public SpliteratorIterator(Spliterator<T> spliterator) {
        this.spliterator = spliterator;
    }

    @Override
    public boolean hasNext() {
        if (!scanned) {
            available = spliterator.tryAdvance(this);
            scanned = true;
        }
        return available;
    }

    @Override
    public T next() {
        if (!hasNext()) {
            throw new NoSuchElementException();
        }
        var result = next;
        next = null;
        scanned = false;
        available = false;
        return result;
    }

    @Override
    public void accept(T value) {
        next = value;
    }
}
