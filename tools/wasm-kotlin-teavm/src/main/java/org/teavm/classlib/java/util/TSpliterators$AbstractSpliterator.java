package org.teavm.classlib.java.util;

public abstract class TSpliterators$AbstractSpliterator<T> implements TSpliterator<T> {
    private final long estimatedSize;
    private final int characteristics;

    public TSpliterators$AbstractSpliterator(long estimatedSize, int additionalCharacteristics) {
        this.estimatedSize = estimatedSize;
        characteristics = additionalCharacteristics;
    }

    @Override
    public TSpliterator<T> trySplit() {
        return null;
    }

    @Override
    public long estimateSize() {
        return estimatedSize;
    }

    @Override
    public int characteristics() {
        return characteristics;
    }
}
