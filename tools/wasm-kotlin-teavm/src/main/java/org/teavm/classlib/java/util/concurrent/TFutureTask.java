package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TObject;
import org.teavm.classlib.java.lang.TRunnable;

public class TFutureTask<V extends TObject> implements TRunnableFuture<V> {
    private V value;
    private boolean done;

    public TFutureTask(TCallable<V> callable) {
        try {
            value = callable.call();
        } catch (Throwable ignored) {
        }
        done = true;
    }

    public TFutureTask(TRunnable runnable, V result) {
        runnable.run();
        value = result;
        done = true;
    }

    @Override
    public void run() {
        done = true;
    }

    protected boolean runAndReset() {
        done = true;
        return true;
    }

    protected void set(V value) {
        this.value = value;
        done = true;
    }

    protected void setException(Throwable throwable) {
        done = true;
    }

    @Override
    public boolean cancel(boolean mayInterruptIfRunning) {
        done = true;
        return false;
    }

    @Override
    public boolean isCancelled() {
        return false;
    }

    @Override
    public boolean isDone() {
        return done;
    }

    @Override
    public V get() {
        return value;
    }

    @Override
    public V get(long timeout, TTimeUnit unit) {
        return value;
    }
}
