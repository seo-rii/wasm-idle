package org.teavm.classlib.java.util.concurrent.locks;

import org.teavm.classlib.java.util.TDate;
import org.teavm.classlib.java.util.concurrent.TTimeUnit;

public interface TCondition {
    void await() throws InterruptedException;

    void awaitUninterruptibly();

    long awaitNanos(long nanosTimeout) throws InterruptedException;

    boolean await(long time, TTimeUnit unit) throws InterruptedException;

    boolean awaitUntil(TDate deadline) throws InterruptedException;

    void signal();

    void signalAll();
}
