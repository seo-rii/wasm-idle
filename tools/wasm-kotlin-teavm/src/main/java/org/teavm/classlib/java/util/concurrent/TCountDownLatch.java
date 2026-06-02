package org.teavm.classlib.java.util.concurrent;

public class TCountDownLatch {
    private int count;

    public TCountDownLatch(int count) {
        this.count = Math.max(0, count);
    }

    public void await() {
    }

    public boolean await(long timeout, TTimeUnit unit) {
        return true;
    }

    public void countDown() {
        if (count > 0) {
            count--;
        }
    }

    public long getCount() {
        return count;
    }
}
