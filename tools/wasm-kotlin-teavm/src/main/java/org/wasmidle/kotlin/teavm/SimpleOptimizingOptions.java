package org.wasmidle.kotlin.teavm;

import org.jetbrains.kotlin.descriptors.ModuleDescriptor;
import org.jetbrains.kotlin.resolve.scopes.optimization.OptimizingOptions;

public enum SimpleOptimizingOptions implements OptimizingOptions {
    INSTANCE;

    @Override
    public boolean shouldCalculateAllNamesForLazyImportScopeOptimizing(ModuleDescriptor moduleDescriptor) {
        return false;
    }
}
