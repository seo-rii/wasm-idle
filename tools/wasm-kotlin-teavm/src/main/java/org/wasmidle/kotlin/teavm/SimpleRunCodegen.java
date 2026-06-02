package org.wasmidle.kotlin.teavm;

import org.jetbrains.kotlin.codegen.CodegenFactory;
import org.jetbrains.kotlin.codegen.state.GenerationState;
import org.jetbrains.kotlin.progress.ProgressIndicatorAndCompilationCanceledStatus;

public final class SimpleRunCodegen {
    private static String lastStatus = "not-run";

    private SimpleRunCodegen() {
    }

    public static String getLastStatus() {
        return lastStatus;
    }

    public static GenerationState run(
            CodegenFactory.CodegenInput input,
            GenerationState state,
            CodegenFactory factory) {
        lastStatus = "start input=" + (input != null) + " state=" + (state != null)
                + " factory=" + (factory != null);
        ProgressIndicatorAndCompilationCanceledStatus.checkCanceled();
        var safeState = state == null && input != null ? input.getState() : state;
        lastStatus += " safeState=" + (safeState != null);
        if (factory != null && input != null) {
            factory.invokeCodegen(input);
            lastStatus += " invoked=true";
        } else {
            lastStatus += " invoked=false";
        }
        if (safeState != null) {
            CodegenFactory.Companion.doCheckCancelled(safeState);
            var classFileFactory = safeState.getFactory();
            lastStatus += " classFileFactory=" + (classFileFactory != null);
            if (classFileFactory != null) {
                classFileFactory.done();
                lastStatus += " done=true";
            } else {
                lastStatus += " done=false";
            }
        } else {
            lastStatus += " classFileFactory=false done=false";
        }
        ProgressIndicatorAndCompilationCanceledStatus.checkCanceled();
        lastStatus += " finished=true";
        return safeState;
    }
}
