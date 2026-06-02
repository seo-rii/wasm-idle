package org.wasmidle.kotlin.teavm;

import com.intellij.util.containers.ConcurrentIntObjectMap;
import com.intellij.util.containers.IntObjectMap;
import java.util.Collection;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

public final class SimpleConcurrentIntObjectMap<V> implements ConcurrentIntObjectMap<V> {
    private final Map<Integer, V> values = new HashMap<>();

    @Override
    public V cacheOrGet(int key, V value) {
        var previous = values.get(key);
        if (previous != null) {
            return previous;
        }
        values.put(key, value);
        return value;
    }

    @Override
    public boolean remove(int key, V value) {
        var previous = values.get(key);
        if (previous != value && (previous == null || !previous.equals(value))) {
            return false;
        }
        values.remove(key);
        return true;
    }

    @Override
    public boolean replace(int key, V oldValue, V newValue) {
        var previous = values.get(key);
        if (previous != oldValue && (previous == null || !previous.equals(oldValue))) {
            return false;
        }
        values.put(key, newValue);
        return true;
    }

    @Override
    public Enumeration<V> elements() {
        return Collections.enumeration(values.values());
    }

    @Override
    public int size() {
        return values.size();
    }

    @Override
    public V putIfAbsent(int key, V value) {
        var previous = values.get(key);
        if (previous == null) {
            values.put(key, value);
        }
        return previous;
    }

    @Override
    public V put(int key, V value) {
        return values.put(key, value);
    }

    @Override
    public V get(int key) {
        return values.get(key);
    }

    @Override
    public V remove(int key) {
        return values.remove(key);
    }

    @Override
    public Collection<V> values() {
        return values.values();
    }

    @Override
    public Set<IntObjectMap.Entry<V>> entrySet() {
        return Collections.emptySet();
    }
}
