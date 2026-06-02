package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TObject;
import org.teavm.classlib.java.lang.TRunnable;
import org.teavm.classlib.java.util.TCollection;
import org.teavm.classlib.java.util.TCollections;
import org.teavm.classlib.java.util.TList;

public class TThreadPoolExecutor implements TExecutorService {
    private boolean shutdown;

    public TThreadPoolExecutor(int corePoolSize, int maximumPoolSize, long keepAliveTime, TTimeUnit unit,
            TBlockingQueue<TRunnable> workQueue) {
    }

    public TThreadPoolExecutor(int corePoolSize, int maximumPoolSize, long keepAliveTime, TTimeUnit unit,
            TBlockingQueue<TRunnable> workQueue, TThreadFactory threadFactory) {
    }

    public TThreadPoolExecutor(int corePoolSize, int maximumPoolSize, long keepAliveTime, TTimeUnit unit,
            TBlockingQueue<TRunnable> workQueue, TRejectedExecutionHandler handler) {
    }

    public TThreadPoolExecutor(int corePoolSize, int maximumPoolSize, long keepAliveTime, TTimeUnit unit,
            TBlockingQueue<TRunnable> workQueue, TThreadFactory threadFactory, TRejectedExecutionHandler handler) {
    }

    @Override
    public void execute(TRunnable command) {
        command.run();
    }

    @Override
    public void shutdown() {
        shutdown = true;
    }

    @Override
    public TList<TRunnable> shutdownNow() {
        shutdown = true;
        return TCollections.emptyList();
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
    public <T extends TObject> TFuture<T> submit(TCallable<T> task) {
        return newTaskFor(task);
    }

    @Override
    public <T extends TObject> TFuture<T> submit(TRunnable task, T result) {
        var future = newTaskFor(task, result);
        future.run();
        return future;
    }

    @Override
    public TFuture<?> submit(TRunnable task) {
        return submit(task, null);
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

    protected <T extends TObject> TRunnableFuture<T> newTaskFor(TRunnable runnable, T value) {
        return new TFutureTask<>(runnable, value);
    }

    protected <T extends TObject> TRunnableFuture<T> newTaskFor(TCallable<T> callable) {
        return new TFutureTask<>(callable);
    }

    protected void afterExecute(TRunnable runnable, Throwable throwable) {
    }

    public void setCorePoolSize(int corePoolSize) {
    }

    public void allowCoreThreadTimeOut(boolean value) {
    }

    public void setMaximumPoolSize(int maximumPoolSize) {
    }

    public void setKeepAliveTime(long time, TTimeUnit unit) {
    }

    public void setThreadFactory(TThreadFactory threadFactory) {
    }
}
