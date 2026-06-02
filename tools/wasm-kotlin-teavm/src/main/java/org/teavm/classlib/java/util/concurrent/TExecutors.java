package org.teavm.classlib.java.util.concurrent;

import org.teavm.classlib.java.lang.TObject;
import org.teavm.classlib.java.lang.TRunnable;
import org.teavm.classlib.java.util.TArrayList;
import org.teavm.classlib.java.util.TCollection;
import org.teavm.classlib.java.util.TCollections;
import org.teavm.classlib.java.util.TIterator;
import org.teavm.classlib.java.util.TList;

public final class TExecutors {
    private TExecutors() {
    }

    public static TExecutorService newFixedThreadPool(int nThreads) {
        return new ImmediateExecutorService();
    }

    public static TExecutorService newSingleThreadExecutor() {
        return new ImmediateExecutorService();
    }

    private static final class ImmediateExecutorService implements TExecutorService {
        private boolean shutdown;

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
            try {
                return new ImmediateFuture<>(task.call(), null);
            } catch (Throwable failure) {
                return new ImmediateFuture<>(null, failure);
            }
        }

        @Override
        public <T extends TObject> TFuture<T> submit(TRunnable task, T result) {
            try {
                task.run();
                return new ImmediateFuture<>(result, null);
            } catch (Throwable failure) {
                return new ImmediateFuture<>(null, failure);
            }
        }

        @Override
        public TFuture<?> submit(TRunnable task) {
            return submit(task, null);
        }

        @Override
        public <T extends TObject> TList<TFuture<T>> invokeAll(TCollection<? extends TCallable<T>> tasks) {
            TArrayList<TFuture<T>> futures = new TArrayList<>(tasks.size());
            TIterator<? extends TCallable<T>> iterator = tasks.iterator();
            while (iterator.hasNext()) {
                futures.add(submit(iterator.next()));
            }
            return futures;
        }

        @Override
        public <T extends TObject> TList<TFuture<T>> invokeAll(TCollection<? extends TCallable<T>> tasks,
                long timeout, TTimeUnit unit) {
            return invokeAll(tasks);
        }

        @Override
        public <T extends TObject> T invokeAny(TCollection<? extends TCallable<T>> tasks) throws TExecutionException {
            Throwable failure = null;
            TIterator<? extends TCallable<T>> iterator = tasks.iterator();
            while (iterator.hasNext()) {
                try {
                    return iterator.next().call();
                } catch (Throwable currentFailure) {
                    failure = currentFailure;
                }
            }
            throw new TExecutionException(failure);
        }

        @Override
        public <T extends TObject> T invokeAny(TCollection<? extends TCallable<T>> tasks, long timeout, TTimeUnit unit)
                throws TExecutionException {
            return invokeAny(tasks);
        }
    }

    static final class ImmediateFuture<T> implements TFuture<T> {
        private final T value;
        private final Throwable failure;

        ImmediateFuture(T value, Throwable failure) {
            this.value = value;
            this.failure = failure;
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
}
