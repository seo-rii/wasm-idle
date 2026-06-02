package org.wasmidle.kotlin.teavm;

import com.intellij.util.containers.ConcurrentLongObjectMap;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class SimpleConcurrentLongObjectMap<V> implements ConcurrentLongObjectMap<V> {
    private final Map<Long, V> values = new HashMap<>();

    @Override
    public V put(long key, V value) {
        return values.put(key, value);
    }

    @Override
    public V get(long key) {
        return values.get(key);
    }

    @Override
    public V remove(long key) {
        return values.remove(key);
    }

    @Override
    public Iterable<ConcurrentLongObjectMap.LongEntry<V>> entries() {
        return Collections.emptyList();
    }

    @Override
    public V putIfAbsent(long key, V value) {
        var previous = values.get(key);
        if (previous == null) {
            values.put(key, value);
        }
        return previous;
    }
}
