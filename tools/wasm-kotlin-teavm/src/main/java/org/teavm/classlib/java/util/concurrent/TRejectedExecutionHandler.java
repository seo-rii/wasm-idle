package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TRunnable;

public interface TRejectedExecutionHandler {
    void rejectedExecution(TRunnable runnable, TThreadPoolExecutor executor);
}
