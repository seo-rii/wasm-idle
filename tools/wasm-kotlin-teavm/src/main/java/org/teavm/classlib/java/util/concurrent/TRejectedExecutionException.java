package org.teavm.classlib.java.util.concurrent;

public class TRejectedExecutionException extends RuntimeException {
    public TRejectedExecutionException() {
    }

    public TRejectedExecutionException(String message) {
        super(message);
    }

    public TRejectedExecutionException(Throwable cause) {
        super(cause);
    }

    public TRejectedExecutionException(String message, Throwable cause) {
        super(message, cause);
    }
}
