package org.teavm.classlib.java.util.concurrent.locks;

import org.teavm.classlib.java.io.TSerializable;
import org.teavm.classlib.java.util.concurrent.TTimeUnit;

public class TReentrantReadWriteLock implements TReadWriteLock, TSerializable {
    private final boolean fair;
    private final ReadLock readLock = new ReadLock(this);
    private final WriteLock writeLock = new WriteLock(this);
    private int readHoldCount;
    private int writeHoldCount;

    public TReentrantReadWriteLock() {
        this(false);
    }

    public TReentrantReadWriteLock(boolean fair) {
        this.fair = fair;
    }

    @Override
    public ReadLock readLock() {
        return readLock;
    }

    @Override
    public WriteLock writeLock() {
        return writeLock;
    }

    public final boolean isFair() {
        return fair;
    }

    public int getReadLockCount() {
        return readHoldCount;
    }

    public boolean isWriteLocked() {
        return writeHoldCount > 0;
    }

    public boolean isWriteLockedByCurrentThread() {
        return writeHoldCount > 0;
    }

    public int getWriteHoldCount() {
        return writeHoldCount;
    }

    public int getReadHoldCount() {
        return readHoldCount;
    }

    public final boolean hasQueuedThreads() {
        return false;
    }

    public final boolean hasQueuedThread(Thread thread) {
        return false;
    }

    public final int getQueueLength() {
        return 0;
    }

    public boolean hasWaiters(TCondition condition) {
        return false;
    }

    public int getWaitQueueLength(TCondition condition) {
        return 0;
    }

    public static class ReadLock implements TLock, TSerializable {
        private final TReentrantReadWriteLock owner;

        ReadLock(TReentrantReadWriteLock owner) {
            this.owner = owner;
        }

        @Override
        public void lock() {
            owner.readHoldCount++;
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
            if (owner.readHoldCount > 0) {
                owner.readHoldCount--;
            }
        }

        @Override
        public TCondition newCondition() {
            return TNoOpCondition.INSTANCE;
        }
    }

    public static class WriteLock implements TLock, TSerializable {
        private final TReentrantReadWriteLock owner;

        WriteLock(TReentrantReadWriteLock owner) {
            this.owner = owner;
        }

        @Override
        public void lock() {
            owner.writeHoldCount++;
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
            if (owner.writeHoldCount > 0) {
                owner.writeHoldCount--;
            }
        }

        @Override
        public TCondition newCondition() {
            return TNoOpCondition.INSTANCE;
        }

        public boolean isHeldByCurrentThread() {
            return owner.writeHoldCount > 0;
        }

        public int getHoldCount() {
            return owner.writeHoldCount;
        }
    }
}
