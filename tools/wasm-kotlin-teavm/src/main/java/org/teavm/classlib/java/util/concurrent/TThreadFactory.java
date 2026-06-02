package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TRunnable;
import org.teavm.classlib.java.lang.TThread;

public interface TThreadFactory {
    TThread newThread(TRunnable runnable);
}
