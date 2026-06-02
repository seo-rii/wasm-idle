package org.teavm.classlib.java.util.concurrent;

public class TForkJoinTask<T> implements TFuture<T> {
    private final T value;
    private final Throwable failure;

    TForkJoinTask(T value, Throwable failure) {
        this.value = value;
        this.failure = failure;
    }

    public final T join() {
        if (failure instanceof RuntimeException) {
            throw (RuntimeException) failure;
        }
        if (failure != null) {
            throw new RuntimeException(failure);
        }
        return value;
    }

    @Override
    public boolean cancel(boolean mayInterruptIfRunning) {
        return false;
    }

    @Override
    public boolean isCancelled() {
        return false;
    }

    @Override
    public boolean isDone() {
        return true;
    }

    @Override
    public T get() throws TExecutionException {
        if (failure != null) {
            throw new TExecutionException(failure);
        }
        return value;
    }

    @Override
    public T get(long timeout, TTimeUnit unit) throws TExecutionException {
        return get();
    }
}
