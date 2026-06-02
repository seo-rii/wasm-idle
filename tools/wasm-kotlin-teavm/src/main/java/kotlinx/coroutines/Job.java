package kotlinx.coroutines;

import kotlin.jvm.functions.Function1;

public interface Job {
    default DisposableHandle invokeOnCompletion(Function1 handler) {
        return () -> {
        };
    }
}
