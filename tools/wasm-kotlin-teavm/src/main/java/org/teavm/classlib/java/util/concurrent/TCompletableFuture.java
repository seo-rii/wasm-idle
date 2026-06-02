package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TRunnable;
import org.teavm.classlib.java.util.function.TBiFunction;
import org.teavm.classlib.java.util.function.TSupplier;

public class TCompletableFuture<T> implements TFuture<T> {
    private T value;
    private Throwable failure;
    private boolean done;

    public TCompletableFuture() {
    }

    private TCompletableFuture(T value, Throwable failure, boolean done) {
        this.value = value;
        this.failure = failure;
        this.done = done;
    }

    public static <U> TCompletableFuture<U> completedFuture(U value) {
        return new TCompletableFuture<>(value, null, true);
    }

    public static <U> TCompletableFuture<U> supplyAsync(TSupplier<U> supplier) {
        return supplyAsync(supplier, TRunnable::run);
    }

    public static <U> TCompletableFuture<U> supplyAsync(TSupplier<U> supplier, TExecutor executor) {
        TCompletableFuture<U> future = new TCompletableFuture<>();
        executor.execute(() -> {
            try {
                future.complete(supplier.get());
            } catch (Throwable throwable) {
                future.completeExceptionally(throwable);
            }
        });
        return future;
    }

    public static TCompletableFuture<Void> runAsync(TRunnable runnable) {
        return runAsync(runnable, TRunnable::run);
    }

    public static TCompletableFuture<Void> runAsync(TRunnable runnable, TExecutor executor) {
        TCompletableFuture<Void> future = new TCompletableFuture<>();
        executor.execute(() -> {
            try {
                runnable.run();
                future.complete(null);
            } catch (Throwable throwable) {
                future.completeExceptionally(throwable);
            }
        });
        return future;
    }

    public static TCompletableFuture<Void> allOf(TCompletableFuture<?>... futures) {
        for (TCompletableFuture<?> future : futures) {
            try {
                future.get();
            } catch (TExecutionException executionFailure) {
                return new TCompletableFuture<>(null, executionFailure, true);
            }
        }
        return completedFuture(null);
    }

    public boolean complete(T value) {
        if (done) {
            return false;
        }
        this.value = value;
        done = true;
        return true;
    }

    public boolean completeExceptionally(Throwable throwable) {
        if (done) {
            return false;
        }
        failure = throwable;
        done = true;
        return true;
    }

    public T join() {
        if (failure instanceof RuntimeException) {
            throw (RuntimeException) failure;
        }
        if (failure != null) {
            throw new RuntimeException(failure);
        }
        return value;
    }

    public T getNow(T valueIfAbsent) {
        return done ? join() : valueIfAbsent;
    }

    public <U> TCompletableFuture<U> handle(TBiFunction<? super T, Throwable, ? extends U> function) {
        return completedFuture(function.apply(done ? value : null, failure));
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
        return done;
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
