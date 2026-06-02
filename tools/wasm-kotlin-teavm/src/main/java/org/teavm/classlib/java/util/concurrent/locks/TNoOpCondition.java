package org.teavm.classlib.java.util.concurrent.locks;

import org.teavm.classlib.java.util.TDate;
import org.teavm.classlib.java.util.concurrent.TTimeUnit;

final class TNoOpCondition implements TCondition {
    static final TNoOpCondition INSTANCE = new TNoOpCondition();

    private TNoOpCondition() {
    }

    @Override
    public void await() {
    }

    @Override
    public void awaitUninterruptibly() {
    }

    @Override
    public long awaitNanos(long nanosTimeout) {
        return 0;
    }

    @Override
    public boolean await(long time, TTimeUnit unit) {
        return true;
    }

    @Override
    public boolean awaitUntil(TDate deadline) {
        return true;
    }

    @Override
    public void signal() {
    }

    @Override
    public void signalAll() {
    }
}
