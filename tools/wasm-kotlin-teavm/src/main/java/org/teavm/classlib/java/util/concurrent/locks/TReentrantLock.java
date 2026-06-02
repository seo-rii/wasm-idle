package org.teavm.classlib.java.util.concurrent.locks;

import org.teavm.classlib.java.io.TSerializable;
import org.teavm.classlib.java.util.concurrent.TTimeUnit;

public class TReentrantLock implements TLock, TSerializable {
    private final boolean fair;
    private int holdCount;

    public TReentrantLock() {
        this(false);
    }

    public TReentrantLock(boolean fair) {
        this.fair = fair;
    }

    @Override
    public void lock() {
        holdCount++;
    }

    @Override
    public void lockInterruptibly() {
        lock();
    }

    @Override
    public boolean tryLock() {
        lock();
        return true;
    }

    @Override
    public boolean tryLock(long time, TTimeUnit unit) {
        lock();
        return true;
    }

    @Override
    public void unlock() {
        if (holdCount > 0) {
            holdCount--;
        }
    }

    @Override
    public TCondition newCondition() {
        return TNoOpCondition.INSTANCE;
    }

    public int getHoldCount() {
        return holdCount;
    }

    public boolean isHeldByCurrentThread() {
        return holdCount > 0;
    }

    public boolean isLocked() {
        return holdCount > 0;
    }

    public final boolean isFair() {
        return fair;
    }

    public final boolean hasQueuedThreads() {
        return false;
    }

    public final int getQueueLength() {
        return 0;
    }
}
