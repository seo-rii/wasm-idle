package kotlinx.coroutines;

import kotlin.coroutines.CoroutineContext;

public final class JobKt {
    private static final Job EMPTY_JOB = new Job() {
    };

    private JobKt() {
    }

    public static Job getJob(CoroutineContext context) {
        return EMPTY_JOB;
    }

    public static void ensureActive(Job job) {
    }

    public static void ensureActive(CoroutineContext context) {
    }
}
