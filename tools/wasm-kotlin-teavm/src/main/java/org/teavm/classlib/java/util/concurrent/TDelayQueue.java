package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.util.TAbstractQueue;
import org.teavm.classlib.java.util.TCollection;
import org.teavm.classlib.java.util.TCollections;
import org.teavm.classlib.java.util.TIterator;

public class TDelayQueue<E extends TDelayed> extends TAbstractQueue<E> implements TBlockingQueue<E> {
    public TDelayQueue() {
    }

    public TDelayQueue(TCollection<? extends E> collection) {
    }

    @Override
    public boolean offer(E e) {
        return false;
    }

    @Override
    public E poll() {
        return null;
    }

    @Override
    public E peek() {
        return null;
    }

    @Override
    public TIterator<E> iterator() {
        return TCollections.emptyIterator();
    }

    @Override
    public int size() {
        return 0;
    }

    @Override
    public void put(E e) {
    }

    @Override
    public boolean offer(E e, long timeout, TTimeUnit unit) {
        return offer(e);
    }

    @Override
    public E take() {
        return null;
    }

    @Override
    public E poll(long timeout, TTimeUnit unit) {
        return null;
    }

    @Override
    public int remainingCapacity() {
        return 0;
    }

    @Override
    public int drainTo(TCollection<? super E> collection) {
        return 0;
    }

    @Override
    public int drainTo(TCollection<? super E> collection, int maxElements) {
        return 0;
    }
}
