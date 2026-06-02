package org.wasmidle.kotlin.teavm;

import java.util.List;
import java.util.Collections;
import org.jetbrains.kotlin.container.ResolveKt;
import org.jetbrains.kotlin.container.SingletonTypeComponentDescriptor;
import org.jetbrains.kotlin.container.ValueDescriptor;
import org.jetbrains.kotlin.container.ValueResolveContext;
import org.jetbrains.kotlin.descriptors.ModuleDescriptor;
import org.jetbrains.kotlin.resolve.AnnotationResolver;
import org.jetbrains.kotlin.resolve.AnnotationResolverImpl;
import org.jetbrains.kotlin.resolve.BindingTrace;
import org.jetbrains.kotlin.resolve.BodyResolver;
import org.jetbrains.kotlin.resolve.DeclarationResolver;
import org.jetbrains.kotlin.resolve.FilePreprocessor;
import org.jetbrains.kotlin.resolve.IdentifierChecker;
import org.jetbrains.kotlin.resolve.LazyTopDownAnalyzer;
import org.jetbrains.kotlin.resolve.OverloadResolver;
import org.jetbrains.kotlin.resolve.OverrideResolver;
import org.jetbrains.kotlin.resolve.QualifiedExpressionResolver;
import org.jetbrains.kotlin.resolve.VarianceChecker;
import org.jetbrains.kotlin.resolve.checkers.ClassifierUsageChecker;
import org.jetbrains.kotlin.resolve.deprecation.DeprecationResolver;
import org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProvider;
import org.jetbrains.kotlin.resolve.lazy.FileScopeProvider;
import org.jetbrains.kotlin.resolve.lazy.KotlinCodeAnalyzer;
import org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver;
import org.jetbrains.kotlin.resolve.lazy.ResolveSession;
import org.jetbrains.kotlin.resolve.lazy.TopLevelDescriptorProvider;
import org.jetbrains.kotlin.config.LanguageVersionSettings;
import org.jetbrains.kotlin.builtins.KotlinBuiltIns;
import org.jetbrains.kotlin.storage.LockBasedStorageManager;
import org.jetbrains.kotlin.types.checker.KotlinTypeRefiner;

public final class SimpleKotlinContainer {
    private SimpleKotlinContainer() {
    }

    public static Object createSingleton(
            SingletonTypeComponentDescriptor descriptor, Class<?> klass, ValueResolveContext context) {
        String detail = "";
        try {
            if (klass == LazyTopDownAnalyzer.class) {
                return createLazyTopDownAnalyzer(context);
            }
            if (klass == ResolveSession.class) {
                return SimpleKotlinAnalysisBridge.current(context).session();
            }
            if (klass == KotlinCodeAnalyzer.class || klass == TopLevelDescriptorProvider.class) {
                return SimpleKotlinAnalysisBridge.current(context);
            }
            if (klass == LazyDeclarationResolver.class) {
                return SimpleKotlinAnalysisBridge.current(context).lazyDeclarationResolver();
            }
            if (klass == FileScopeProvider.class) {
                return SimpleKotlinAnalysisBridge.current(context).fileScopeProvider();
            }
            if (klass == DeclarationScopeProvider.class) {
                return SimpleKotlinAnalysisBridge.current(context).declarationScopeProvider();
            }
            if (klass == DeclarationResolver.class) {
                return createDeclarationResolver(context);
            }
            if (klass == AnnotationResolver.class) {
                return createAnnotationResolver();
            }
            if (klass == OverrideResolver.class) {
                return createOverrideResolver(context);
            }
            if (klass == OverloadResolver.class) {
                return createOverloadResolver(context);
            }
            if (klass == VarianceChecker.class) {
                return createVarianceChecker(context);
            }
            if (klass == BodyResolver.class) {
                return createBodyResolver(context);
            }
            var binding = ResolveKt.bindToConstructor(
                    klass, descriptor.getContainer().getContainerId(), context);
            var constructor = binding.getConstructor();
            constructor.setAccessible(true);
            List<Object> arguments = ResolveKt.computeArguments(binding.getArgumentDescriptors());
            detail = " args=" + describeArguments(arguments);
            return constructor.newInstance(arguments.toArray(new Object[0]));
        } catch (Throwable failure) {
            throw new RuntimeException("singleton=" + describe(klass) + detail + " cause=" + describe(failure),
                    failure);
        }
    }

    private static LazyTopDownAnalyzer createLazyTopDownAnalyzer(ValueResolveContext context) {
        return new LazyTopDownAnalyzer(
                resolve(context, BindingTrace.class),
                resolve(context, DeclarationResolver.class),
                resolve(context, OverrideResolver.class),
                resolve(context, OverloadResolver.class),
                resolve(context, VarianceChecker.class),
                resolve(context, ModuleDescriptor.class),
                resolve(context, LazyDeclarationResolver.class),
                resolve(context, BodyResolver.class),
                resolve(context, TopLevelDescriptorProvider.class),
                resolve(context, FileScopeProvider.class),
                resolve(context, DeclarationScopeProvider.class),
                resolve(context, QualifiedExpressionResolver.class),
                resolve(context, IdentifierChecker.class),
                resolve(context, LanguageVersionSettings.class),
                resolve(context, DeprecationResolver.class),
                Collections.<ClassifierUsageChecker>emptyList(),
                resolve(context, FilePreprocessor.class));
    }

    private static <T> T resolve(ValueResolveContext context, Class<T> type) {
        if (type == DeclarationResolver.class) {
            return type.cast(createDeclarationResolver(context));
        }
        if (type == AnnotationResolver.class) {
            return type.cast(createAnnotationResolver());
        }
        if (type == OverrideResolver.class) {
            return type.cast(createOverrideResolver(context));
        }
        if (type == OverloadResolver.class) {
            return type.cast(createOverloadResolver(context));
        }
        if (type == VarianceChecker.class) {
            return type.cast(createVarianceChecker(context));
        }
        if (type == BodyResolver.class) {
            return type.cast(createBodyResolver(context));
        }
        if (type == ResolveSession.class) {
            return type.cast(SimpleKotlinAnalysisBridge.current(context).session());
        }
        if (type == KotlinCodeAnalyzer.class || type == TopLevelDescriptorProvider.class) {
            return type.cast(SimpleKotlinAnalysisBridge.current(context));
        }
        if (type == LazyDeclarationResolver.class) {
            return type.cast(SimpleKotlinAnalysisBridge.current(context).lazyDeclarationResolver());
        }
        if (type == FileScopeProvider.class) {
            return type.cast(SimpleKotlinAnalysisBridge.current(context).fileScopeProvider());
        }
        if (type == DeclarationScopeProvider.class) {
            return type.cast(SimpleKotlinAnalysisBridge.current(context).declarationScopeProvider());
        }
        if (type == TopLevelDescriptorProvider.class) {
            return type.cast(resolve(context, KotlinCodeAnalyzer.class));
        }
        if (type == KotlinCodeAnalyzer.class) {
            return type.cast(resolve(context, ResolveSession.class));
        }
        if (type == FileScopeProvider.class) {
            return type.cast(resolve(context, KotlinCodeAnalyzer.class).getFileScopeProvider());
        }
        if (type == DeclarationScopeProvider.class) {
            return type.cast(resolve(context, KotlinCodeAnalyzer.class).getDeclarationScopeProvider());
        }
        ValueDescriptor descriptor = context.resolve(type);
        if (descriptor == null) {
            throw new IllegalStateException("unresolved dependency=" + describe(type));
        }
        Object value = descriptor.getValue();
        if (value == null) {
            throw new IllegalStateException("null dependency=" + describe(type));
        }
        return type.cast(value);
    }

    private static DeclarationResolver createDeclarationResolver(ValueResolveContext context) {
        return new DeclarationResolver(createAnnotationResolver(), resolve(context, BindingTrace.class));
    }

    private static AnnotationResolver createAnnotationResolver() {
        return new AnnotationResolverImpl(null, null, LockBasedStorageManager.NO_LOCKS);
    }

    private static OverrideResolver createOverrideResolver(ValueResolveContext context) {
        return new OverrideResolver(
                resolve(context, BindingTrace.class),
                null,
                resolve(context, LanguageVersionSettings.class),
                KotlinTypeRefiner.Default.INSTANCE,
                null);
    }

    private static OverloadResolver createOverloadResolver(ValueResolveContext context) {
        return new OverloadResolver(
                resolve(context, BindingTrace.class),
                null,
                null,
                resolve(context, LanguageVersionSettings.class),
                null);
    }

    private static VarianceChecker createVarianceChecker(ValueResolveContext context) {
        return new VarianceChecker(
                resolve(context, BindingTrace.class),
                resolve(context, LanguageVersionSettings.class));
    }

    private static BodyResolver createBodyResolver(ValueResolveContext context) {
        return new BodyResolver(
                null,
                createAnnotationResolver(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                resolve(context, BindingTrace.class),
                null,
                null,
                resolve(context, KotlinBuiltIns.class),
                null,
                resolve(context, LanguageVersionSettings.class));
    }

    private static String describe(Class<?> klass) {
        if (klass == null) {
            return "<null>";
        }
        try {
            return klass.getName();
        } catch (Throwable ignored) {
            return "<unavailable>";
        }
    }

    private static String describe(Throwable failure) {
        if (failure == null) {
            return "<null>";
        }
        String type;
        try {
            type = failure.getClass().getName();
        } catch (Throwable ignored) {
            type = "<unknown>";
        }
        String message;
        try {
            message = failure.getMessage();
        } catch (Throwable ignored) {
            message = null;
        }
        return message == null ? type : type + ":" + message;
    }

    private static String describeArguments(List<Object> arguments) {
        StringBuilder result = new StringBuilder("[");
        for (int index = 0; index < arguments.size(); index++) {
            if (index > 0) {
                result.append(", ");
            }
            result.append(index).append('=');
            Object argument = arguments.get(index);
            if (argument == null) {
                result.append("<null>");
            } else {
                try {
                    result.append(argument.getClass().getName());
                } catch (Throwable ignored) {
                    result.append("<unavailable>");
                }
            }
        }
        result.append(']');
        return result.toString();
    }
}
