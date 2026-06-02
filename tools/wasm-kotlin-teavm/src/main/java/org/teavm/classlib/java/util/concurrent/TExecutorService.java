package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TObject;
import org.teavm.classlib.java.lang.TRunnable;
import org.teavm.classlib.java.util.TCollection;
import org.teavm.classlib.java.util.TList;

public interface TExecutorService extends TExecutor {
    void shutdown();

    TList<TRunnable> shutdownNow();

    boolean isShutdown();

    boolean isTerminated();

    boolean awaitTermination(long timeout, TTimeUnit unit) throws InterruptedException;

    <T extends TObject> TFuture<T> submit(TCallable<T> task);

    <T extends TObject> TFuture<T> submit(TRunnable task, T result);

    TFuture<?> submit(TRunnable task);

    <T extends TObject> TList<TFuture<T>> invokeAll(TCollection<? extends TCallable<T>> tasks)
            throws InterruptedException;

    <T extends TObject> TList<TFuture<T>> invokeAll(TCollection<? extends TCallable<T>> tasks, long timeout,
            TTimeUnit unit) throws InterruptedException;

    <T extends TObject> T invokeAny(TCollection<? extends TCallable<T>> tasks)
            throws InterruptedException, TExecutionException;

    <T extends TObject> T invokeAny(TCollection<? extends TCallable<T>> tasks, long timeout, TTimeUnit unit)
            throws InterruptedException, TExecutionException, TTimeoutException;
}
