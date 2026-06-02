package org.wasmidle.kotlin.teavm;

import com.intellij.mock.MockProject;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import java.util.Collection;
import org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace;
import org.jetbrains.kotlin.config.LanguageVersionSettings;
import org.jetbrains.kotlin.config.LanguageVersionSettingsImpl;
import org.jetbrains.kotlin.container.ValueDescriptor;
import org.jetbrains.kotlin.container.ValueResolveContext;
import org.jetbrains.kotlin.context.GlobalContext;
import org.jetbrains.kotlin.context.GlobalContextImpl;
import org.jetbrains.kotlin.builtins.jvm.JavaToKotlinClassMapper;
import org.jetbrains.kotlin.descriptors.ClassDescriptor;
import org.jetbrains.kotlin.descriptors.ClassifierDescriptor;
import org.jetbrains.kotlin.descriptors.DeclarationDescriptor;
import org.jetbrains.kotlin.descriptors.ModuleDescriptor;
import org.jetbrains.kotlin.descriptors.PackageFragmentProvider;
import org.jetbrains.kotlin.incremental.components.LookupLocation;
import org.jetbrains.kotlin.incremental.components.LookupTracker;
import org.jetbrains.kotlin.load.java.components.JavaDeprecationSettings;
import org.jetbrains.kotlin.name.FqName;
import org.jetbrains.kotlin.psi.KtClassOrObject;
import org.jetbrains.kotlin.psi.KtDeclaration;
import org.jetbrains.kotlin.psi.KtFile;
import org.jetbrains.kotlin.resolve.AnnotationResolver;
import org.jetbrains.kotlin.resolve.AnnotationResolverImpl;
import org.jetbrains.kotlin.resolve.BindingContext;
import org.jetbrains.kotlin.resolve.BindingTrace;
import org.jetbrains.kotlin.resolve.DescriptorResolver;
import org.jetbrains.kotlin.resolve.FunctionDescriptorResolver;
import org.jetbrains.kotlin.resolve.QualifiedExpressionResolver;
import org.jetbrains.kotlin.resolve.TypeResolver;
import org.jetbrains.kotlin.resolve.deprecation.DeprecationResolver;
import org.jetbrains.kotlin.resolve.jvm.platform.JvmPlatformAnalyzerServices;
import org.jetbrains.kotlin.resolve.lazy.BasicAbsentDescriptorHandler;
import org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProvider;
import org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProviderImpl;
import org.jetbrains.kotlin.resolve.lazy.FileScopeFactory;
import org.jetbrains.kotlin.resolve.lazy.FileScopeProvider;
import org.jetbrains.kotlin.resolve.lazy.FileScopeProviderImpl;
import org.jetbrains.kotlin.resolve.lazy.ImportResolutionComponents;
import org.jetbrains.kotlin.resolve.lazy.KotlinCodeAnalyzer;
import org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver;
import org.jetbrains.kotlin.resolve.lazy.ResolveSession;
import org.jetbrains.kotlin.resolve.lazy.TopLevelDescriptorProvider;
import org.jetbrains.kotlin.resolve.lazy.declarations.ClassMemberDeclarationProvider;
import org.jetbrains.kotlin.resolve.lazy.declarations.DeclarationProviderFactory;
import org.jetbrains.kotlin.resolve.lazy.declarations.FileBasedDeclarationProviderFactory;
import org.jetbrains.kotlin.resolve.lazy.declarations.PackageMemberDeclarationProvider;
import org.jetbrains.kotlin.resolve.lazy.descriptors.LazyPackageDescriptor;
import org.jetbrains.kotlin.resolve.lazy.data.KtClassLikeInfo;
import org.jetbrains.kotlin.storage.ExceptionTracker;
import org.jetbrains.kotlin.storage.LockBasedStorageManager;
import org.jetbrains.kotlin.storage.StorageManager;
import org.jetbrains.kotlin.types.checker.KotlinTypePreparator;
import org.jetbrains.kotlin.types.checker.KotlinTypeRefiner;
import org.jetbrains.kotlin.types.checker.NewKotlinTypeChecker;
import org.jetbrains.kotlin.types.checker.NewKotlinTypeCheckerImpl;

public final class SimpleKotlinAnalysisBridge implements KotlinCodeAnalyzer {
    private static SimpleKotlinAnalysisBridge current;

    private ValueResolveContext context;
    private final LockBasedStorageManager storageManager;
    private final GlobalContext globalContext;
    private final BindingTrace trace;
    private final ModuleDescriptor module;
    private final LanguageVersionSettings languageVersionSettings;
    private final NewKotlinTypeChecker typeChecker;
    private final LazyDeclarationResolver lazyDeclarationResolver;
    private final FileScopeProvider fileScopeProvider;
    private final DeclarationScopeProviderImpl declarationScopeProvider;
    private Project project;
    private ResolveSession session;
    private String lastResolveFailure;

    private SimpleKotlinAnalysisBridge(ValueResolveContext context) {
        this.context = context;
        storageManager = new LockBasedStorageManager("wasm-idle-source-analysis");
        globalContext = new GlobalContextImpl(storageManager, new ExceptionTracker());
        trace = firstNonNull(resolveOptional(BindingTrace.class), new NoScopeRecordCliBindingTrace());
        module = firstNonNull(resolveOptional(ModuleDescriptor.class), SimpleModuleDescriptors.create("<wasm-idle>"));
        languageVersionSettings = firstNonNull(
                resolveOptional(LanguageVersionSettings.class),
                LanguageVersionSettingsImpl.DEFAULT);
        typeChecker = firstNonNull(resolveOptional(NewKotlinTypeChecker.class), createTypeChecker());
        fileScopeProvider = createFileScopeProvider();
        lazyDeclarationResolver = new LazyDeclarationResolver(
                globalContext,
                trace,
                this,
                new BasicAbsentDescriptorHandler());
        declarationScopeProvider = new DeclarationScopeProviderImpl(lazyDeclarationResolver, fileScopeProvider);
        lazyDeclarationResolver.setDeclarationScopeProvider(declarationScopeProvider);
    }

    public static synchronized SimpleKotlinAnalysisBridge current(ValueResolveContext context) {
        if (current == null) {
            current = new SimpleKotlinAnalysisBridge(context);
        } else if (current.context == null && context != null) {
            current.context = context;
        }
        return current;
    }

    public static Object service(Class<?> type) {
        return service(type, null);
    }

    public static Object service(Class<?> type, ValueResolveContext context) {
        if (type == ResolveSession.class) {
            return current(context).session();
        }
        if (type == KotlinCodeAnalyzer.class || type == TopLevelDescriptorProvider.class) {
            return current(context);
        }
        if (type == LazyDeclarationResolver.class) {
            return current(context).lazyDeclarationResolver();
        }
        if (type == FileScopeProvider.class) {
            return current(context).fileScopeProvider();
        }
        if (type == DeclarationScopeProvider.class) {
            return current(context).declarationScopeProvider();
        }
        return null;
    }

    public static synchronized void clear() {
        current = null;
    }

    public synchronized ResolveSession session() {
        if (session == null) {
            var created = new ResolveSession(
                    project(),
                    globalContext,
                    module,
                    new SimpleSourceDeclarationProviderFactory(storageManager),
                    trace,
                    typeChecker);
            created.setLazyDeclarationResolver(lazyDeclarationResolver);
            created.setFileScopeProvider(fileScopeProvider);
            created.setDeclarationScopeProvider(declarationScopeProvider);
            created.setLookupTracker(LookupTracker.DO_NOTHING.INSTANCE);
            created.setLanguageVersionSettings(languageVersionSettings);
            var annotationResolver = resolveOptional(AnnotationResolver.class);
            if (annotationResolver == null) {
                annotationResolver = new AnnotationResolverImpl(null, null, LockBasedStorageManager.NO_LOCKS);
            }
            created.setAnnotationResolve(annotationResolver);
            var descriptorResolver = resolveOptional(DescriptorResolver.class);
            if (descriptorResolver != null) {
                created.setDescriptorResolver(descriptorResolver);
            }
            var functionDescriptorResolver = resolveOptional(FunctionDescriptorResolver.class);
            if (functionDescriptorResolver == null) {
                functionDescriptorResolver = createFunctionDescriptorResolver();
            }
            created.setFunctionDescriptorResolver(functionDescriptorResolver);
            var typeResolver = resolveOptional(TypeResolver.class);
            if (typeResolver != null) {
                created.setTypeResolver(typeResolver);
            }
            session = created;
        }
        return session;
    }

    public LazyDeclarationResolver lazyDeclarationResolver() {
        return lazyDeclarationResolver;
    }

    public FileScopeProvider fileScopeProvider() {
        return fileScopeProvider;
    }

    public DeclarationScopeProviderImpl declarationScopeProvider() {
        return declarationScopeProvider;
    }

    @Override
    public ModuleDescriptor getModuleDescriptor() {
        return session().getModuleDescriptor();
    }

    @Override
    public ClassDescriptor getClassDescriptor(KtClassOrObject declaration, LookupLocation location) {
        return session().getClassDescriptor(declaration, location);
    }

    @Override
    public BindingContext getBindingContext() {
        return session().getBindingContext();
    }

    @Override
    public DeclarationDescriptor resolveToDescriptor(KtDeclaration declaration) {
        return session().resolveToDescriptor(declaration);
    }

    @Override
    public DeclarationScopeProvider getDeclarationScopeProvider() {
        return declarationScopeProvider;
    }

    @Override
    public FileScopeProvider getFileScopeProvider() {
        return fileScopeProvider;
    }

    @Override
    public void forceResolveAll() {
        session().forceResolveAll();
    }

    @Override
    public PackageFragmentProvider getPackageFragmentProvider() {
        return session().getPackageFragmentProvider();
    }

    @Override
    public LazyPackageDescriptor getPackageFragment(FqName fqName) {
        return session().getPackageFragment(fqName);
    }

    @Override
    public LazyPackageDescriptor getPackageFragmentOrDiagnoseFailure(FqName fqName, KtFile file) {
        return session().getPackageFragmentOrDiagnoseFailure(fqName, file);
    }

    @Override
    public Collection<ClassifierDescriptor> getTopLevelClassifierDescriptors(
            FqName fqName, LookupLocation location) {
        return session().getTopLevelClassifierDescriptors(fqName, location);
    }

    @Override
    public void assertValid() {
        session().assertValid();
    }

    private Project project() {
        if (project == null) {
            project = new MockProject(null, Disposer.newDisposable());
        }
        return project;
    }

    private <T> T resolveOptional(Class<T> type) {
        if (context == null) {
            return null;
        }
        try {
            ValueDescriptor descriptor = context.resolve(type);
            if (descriptor == null || descriptor.getValue() == null) {
                lastResolveFailure = type.getName() + " -> null";
                return null;
            }
            return type.cast(descriptor.getValue());
        } catch (Throwable failure) {
            lastResolveFailure = type.getName() + " -> " + describe(failure);
            return null;
        }
    }

    private static NewKotlinTypeChecker createTypeChecker() {
        return new NewKotlinTypeCheckerImpl(
                KotlinTypeRefiner.Default.INSTANCE,
                KotlinTypePreparator.Default.INSTANCE);
    }

    private FunctionDescriptorResolver createFunctionDescriptorResolver() {
        return new FunctionDescriptorResolver(
                null,
                null,
                new AnnotationResolverImpl(null, null, LockBasedStorageManager.NO_LOCKS),
                module.getBuiltIns(),
                null,
                null,
                null,
                null,
                languageVersionSettings,
                storageManager);
    }

    private FileScopeProvider createFileScopeProvider() {
        var importComponents = new ImportResolutionComponents(
                storageManager,
                new QualifiedExpressionResolver(languageVersionSettings),
                module,
                JavaToKotlinClassMapper.INSTANCE,
                languageVersionSettings,
                new DeprecationResolver(storageManager, languageVersionSettings, JavaDeprecationSettings.INSTANCE),
                SimpleOptimizingOptions.INSTANCE);
        return new FileScopeProviderImpl(
                new FileScopeFactory(this, trace, JvmPlatformAnalyzerServices.INSTANCE, importComponents),
                trace,
                storageManager);
    }

    private static <T> T firstNonNull(T value, T fallback) {
        return value == null ? fallback : value;
    }

    private static String describe(Throwable failure) {
        if (failure == null) {
            return "<null>";
        }
        String message = failure.getMessage();
        return failure.getClass().getName() + (message == null ? "" : ":" + message);
    }

    private static final class SimpleSourceDeclarationProviderFactory implements DeclarationProviderFactory {
        private final StorageManager storageManager;
        private FileBasedDeclarationProviderFactory delegate;
        private int fileCount = -1;

        private SimpleSourceDeclarationProviderFactory(StorageManager storageManager) {
            this.storageManager = storageManager;
        }

        @Override
        public ClassMemberDeclarationProvider getClassMemberDeclarationProvider(KtClassLikeInfo classLikeInfo) {
            return delegate().getClassMemberDeclarationProvider(classLikeInfo);
        }

        @Override
        public PackageMemberDeclarationProvider getPackageMemberDeclarationProvider(FqName fqName) {
            return delegate().getPackageMemberDeclarationProvider(fqName);
        }

        @Override
        public void diagnoseMissingPackageFragment(FqName fqName, KtFile file) {
            delegate().diagnoseMissingPackageFragment(fqName, file);
        }

        private synchronized FileBasedDeclarationProviderFactory delegate() {
            var sourceFiles = SimpleSourceRegistry.files();
            if (delegate == null || fileCount != sourceFiles.size()) {
                delegate = new FileBasedDeclarationProviderFactory(storageManager, sourceFiles);
                fileCount = sourceFiles.size();
            }
            return delegate;
        }
    }
}
