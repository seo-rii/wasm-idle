package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TObject;
import org.teavm.classlib.java.lang.TRunnable;
import org.teavm.classlib.java.util.TCollection;
import org.teavm.classlib.java.util.TList;

public class TForkJoinPool implements TExecutorService {
    private static final TForkJoinPool COMMON = new TForkJoinPool();
    private boolean shutdown;

    public TForkJoinPool() {
    }

    public TForkJoinPool(int parallelism) {
    }

    public static TForkJoinPool commonPool() {
        return COMMON;
    }

    public static int getCommonPoolParallelism() {
        return 1;
    }

    @Override
    public void execute(TRunnable command) {
        command.run();
    }

    public <T extends TObject> TForkJoinTask<T> submit(TCallable<T> task) {
        try {
            return new TForkJoinTask<>(task.call(), null);
        } catch (Throwable failure) {
            return new TForkJoinTask<>(null, failure);
        }
    }

    @Override
    public <T extends TObject> TFuture<T> submit(TRunnable task, T result) {
        task.run();
        return TCompletableFuture.completedFuture(result);
    }

    @Override
    public TFuture<?> submit(TRunnable task) {
        task.run();
        return TCompletableFuture.completedFuture(null);
    }

    @Override
    public void shutdown() {
        shutdown = true;
    }

    @Override
    public TList<TRunnable> shutdownNow() {
        shutdown = true;
        return TExecutors.newSingleThreadExecutor().shutdownNow();
    }

    @Override
    public boolean isShutdown() {
        return shutdown;
    }

    @Override
    public boolean isTerminated() {
        return shutdown;
    }

    @Override
    public boolean awaitTermination(long timeout, TTimeUnit unit) {
        return true;
    }

    @Override
    public <T extends TObject> TList<TFuture<T>> invokeAll(TCollection<? extends TCallable<T>> tasks)
            throws InterruptedException {
        return TExecutors.newSingleThreadExecutor().invokeAll(tasks);
    }

    @Override
    public <T extends TObject> TList<TFuture<T>> invokeAll(TCollection<? extends TCallable<T>> tasks, long timeout,
            TTimeUnit unit) throws InterruptedException {
        return invokeAll(tasks);
    }

    @Override
    public <T extends TObject> T invokeAny(TCollection<? extends TCallable<T>> tasks)
            throws InterruptedException, TExecutionException {
        return TExecutors.newSingleThreadExecutor().invokeAny(tasks);
    }

    @Override
    public <T extends TObject> T invokeAny(TCollection<? extends TCallable<T>> tasks, long timeout, TTimeUnit unit)
            throws InterruptedException, TExecutionException, TTimeoutException {
        return invokeAny(tasks);
    }
}
