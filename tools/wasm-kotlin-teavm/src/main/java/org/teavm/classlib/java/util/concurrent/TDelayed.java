package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TComparable;

public interface TDelayed extends TComparable<TDelayed> {
    long getDelay(TTimeUnit unit);
}
