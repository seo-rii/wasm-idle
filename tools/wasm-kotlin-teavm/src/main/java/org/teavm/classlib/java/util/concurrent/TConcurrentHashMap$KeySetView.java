package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.util.TAbstractSet;
import org.teavm.classlib.java.util.TCollections;
import org.teavm.classlib.java.util.TIterator;

public class TConcurrentHashMap$KeySetView<K, V> extends TAbstractSet<K> {
    private final V value;

    public TConcurrentHashMap$KeySetView() {
        this.value = null;
    }

    public TConcurrentHashMap$KeySetView(TConcurrentHashMap<K, V> map, V value) {
        this.value = value;
    }

    public V getMappedValue() {
        return value;
    }

    @Override
    public TIterator<K> iterator() {
        return TCollections.emptyIterator();
    }

    @Override
    public int size() {
        return 0;
    }

    @Override
    public boolean contains(Object object) {
        return false;
    }

    @Override
    public boolean add(K element) {
        return false;
    }

    @Override
    public boolean remove(Object object) {
        return false;
    }
}
