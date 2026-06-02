package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.io.TSerializable;
import org.teavm.classlib.java.util.TAbstractQueue;
import org.teavm.classlib.java.util.TCollection;
import org.teavm.classlib.java.util.TIterator;
import org.teavm.classlib.java.util.TLinkedList;

public class TConcurrentLinkedQueue<E> extends TAbstractQueue<E> implements TSerializable {
    private final TLinkedList<E> list = new TLinkedList<>();

    public TConcurrentLinkedQueue() {
    }

    public TConcurrentLinkedQueue(TCollection<? extends E> collection) {
        addAll(collection);
    }

    @Override
    public boolean offer(E value) {
        return list.offer(value);
    }

    @Override
    public E poll() {
        return list.poll();
    }

    @Override
    public E peek() {
        return list.peek();
    }

    @Override
    public TIterator<E> iterator() {
        return list.iterator();
    }

    @Override
    public int size() {
        return list.size();
    }
}
