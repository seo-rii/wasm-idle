package org.wasmidle.kotlin.teavm;

import org.jetbrains.kotlin.context.GlobalContextImpl;
import org.jetbrains.kotlin.resolve.BindingTrace;
import org.jetbrains.kotlin.resolve.TopDownAnalysisContext;
import org.jetbrains.kotlin.resolve.TopDownAnalysisMode;
import org.jetbrains.kotlin.resolve.calls.smartcasts.DataFlowInfo;
import org.jetbrains.kotlin.resolve.calls.smartcasts.DataFlowInfoFactory;
import org.jetbrains.kotlin.resolve.lazy.BasicAbsentDescriptorHandler;
import org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProvider;
import org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProviderImpl;
import org.jetbrains.kotlin.resolve.lazy.FileScopeProvider;
import org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver;
import org.jetbrains.kotlin.resolve.lazy.NoTopLevelDescriptorProvider;
import org.jetbrains.kotlin.storage.ExceptionTracker;
import org.jetbrains.kotlin.storage.LockBasedStorageManager;
import org.jetbrains.kotlin.types.expressions.ExpressionTypingContext;

public final class SimpleTopDownAnalysisContext {
    private SimpleTopDownAnalysisContext() {
    }

    public static TopDownAnalysisContext create(
            TopDownAnalysisMode mode,
            DataFlowInfo dataFlowInfo,
            DeclarationScopeProvider scopeProvider,
            BindingTrace trace,
            ExpressionTypingContext expressionContext) {
        var safeDataFlowInfo = dataFlowInfo == null ? DataFlowInfoFactory.EMPTY : dataFlowInfo;
        var safeScopeProvider = scopeProvider;
        if (safeScopeProvider == null) {
            var lazyDeclarationResolver = new LazyDeclarationResolver(
                    new GlobalContextImpl(
                            new LockBasedStorageManager("wasm-idle"),
                            new ExceptionTracker()),
                    trace,
                    NoTopLevelDescriptorProvider.INSTANCE,
                    new BasicAbsentDescriptorHandler());
            var declarationScopeProvider = new DeclarationScopeProviderImpl(
                    lazyDeclarationResolver,
                    FileScopeProvider.ThrowException.INSTANCE);
            lazyDeclarationResolver.setDeclarationScopeProvider(declarationScopeProvider);
            safeScopeProvider = declarationScopeProvider;
        }
        return new TopDownAnalysisContext(mode, safeDataFlowInfo, safeScopeProvider, expressionContext);
    }
}
