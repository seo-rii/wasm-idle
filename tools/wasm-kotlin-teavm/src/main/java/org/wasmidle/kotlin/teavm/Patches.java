package org.wasmidle.kotlin.teavm;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.teavm.model.AccessLevel;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
import org.teavm.model.ElementModifier;
import org.teavm.model.MethodDescriptor;
import org.teavm.model.MethodHolder;
import org.teavm.model.ValueType;
import org.teavm.model.emit.ProgramEmitter;
import org.teavm.vm.spi.TeaVMHost;
import org.teavm.vm.spi.TeaVMPlugin;

public final class Patches implements TeaVMPlugin, ClassHolderTransformer {
    private static final Set<String> SUBMITTED_SYNTHETIC_CLASSES = Collections.synchronizedSet(new HashSet<>());

    @Override
    public void install(TeaVMHost host) {
        host.add(this);
    }

    @Override
    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        submitSyntheticClasses(context);
        stripClassAnnotations(cls);
        switch (cls.getName()) {
            case "java.lang.Class":
                transformLangClass(cls, context);
                break;
            case "java.lang.String":
                transformString(cls, context);
                break;
            case "java.lang.Character":
                transformCharacter(cls, context);
                break;
            case "java.nio.charset.Charset":
                transformCharset(cls, context);
                break;
            case "java.text.MessageFormat":
                transformMessageFormat(cls, context);
                break;
            case "java.lang.ref.WeakReference":
            case "org.teavm.classlib.java.lang.ref.TWeakReference":
                transformWeakReference(cls, context);
                break;
            case "com.intellij.BundleBase":
                transformBundleBase(cls, context);
                break;
            case "com.intellij.util.text.OrdinalFormat":
                transformOrdinalFormat(cls, context);
                break;
            case "kotlin.jvm.internal.CallableReference":
                transformCallableReference(cls, context);
                break;
            case "kotlin.jvm.internal.ClassReference":
                transformClassReference(cls, context);
                break;
            case "java.io.File":
                transformFile(cls, context);
                break;
            case "java.io.InputStreamReader":
                replaceWithNoOp(cls, context, "close", ValueType.VOID);
                replaceWithConstantInt(cls, context, "read", -1);
                replaceWithConstantInt(cls, context, "read", -1,
                        ValueType.arrayOf(ValueType.CHARACTER), ValueType.INTEGER, ValueType.INTEGER);
                replaceWithConstantInt(cls, context, "read", -1,
                        ValueType.object("java.nio.CharBuffer"));
                replaceWithConstantBoolean(cls, context, "ready", false);
                break;
            case "java.io.BufferedReader":
                replaceWithNoOp(cls, context, "close", ValueType.VOID);
                break;
            case "java.lang.ClassLoader":
                transformClassLoader(cls, context);
                break;
            case "java.lang.Long":
                transformLong(cls, context);
                break;
            case "java.lang.Integer":
                transformInteger(cls, context);
                break;
            case "org.teavm.runtime.Fiber":
                replaceWithConstantBoolean(cls, context, "isResuming", false);
                replaceWithConstantBoolean(cls, context, "isSuspending", false);
                break;
            case "java.util.Locale":
                transformLocale(cls, context);
                break;
            case "java.lang.Runtime":
                transformRuntime(cls, context);
                break;
            case "java.lang.System":
                transformSystem(cls, context);
                break;
            case "com.intellij.openapi.util.io.FileSystemUtil":
                transformFileSystemUtil(cls, context);
                break;
            case "org.teavm.classlib.impl.unicode.CLDRHelper":
                transformCLDRHelper(cls, context);
                break;
            case "org.teavm.classlib.java.net.impl.TXHRURLConnection":
            case "java.net.impl.XHRURLConnection":
                transformXHRURLConnection(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.arguments.ParseCommandLineArgumentsKt":
                transformParseCommandLineArgumentsKt(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.arguments.ArgumentUtilsKt":
                transformArgumentUtilsKt(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.arguments.K2JVMCompilerArguments":
                transformK2JVMCompilerArguments(cls, context);
                break;
            case "org.jetbrains.kotlin.serialization.deserialization.builtins.BuiltInsResourceLoader":
                transformBuiltInsResourceLoader(cls, context);
                break;
            case "org.jetbrains.kotlin.builtins.BuiltInsLoader$Companion":
                transformBuiltInsLoaderCompanion(cls, context);
                break;
            case "org.jetbrains.kotlin.builtins.BuiltInsLoader$Companion$Instance$2":
                transformBuiltInsLoaderInstance(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.ArgumentsKt":
                transformArgumentsKt(cls, context);
                break;
            case "org.jetbrains.kotlin.utils.PathUtil":
                transformPathUtil(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.CommonCompilerPerformanceManager":
                transformCommonCompilerPerformanceManager(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.messages.PlainTextMessageRenderer":
                transformPlainTextMessageRenderer(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.messages.AnalyzerWithCompilerReport":
                transformAnalyzerWithCompilerReport(cls, context);
                break;
            case "org.jetbrains.kotlin.diagnostics.AbstractKtDiagnosticWithParametersRenderer":
                transformAbstractKtDiagnosticWithParametersRenderer(cls, context);
                break;
            case "org.jetbrains.kotlin.fir.builder.FirSyntaxErrors":
                transformFirSyntaxErrors(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.profiling.ProfilingCompilerPerformanceManager":
                transformProfilingCompilerPerformanceManager(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler":
                transformK2JVMCompiler(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.jvm.compiler.KotlinToJVMBytecodeCompiler":
                transformKotlinToJVMBytecodeCompiler(cls, context);
                break;
            case "org.jetbrains.kotlin.codegen.state.GenerationState":
                transformGenerationState(cls, context);
                break;
            case "org.jetbrains.kotlin.codegen.PackageCodegenImpl":
                transformPackageCodegenImpl(cls, context);
                break;
            case "org.jetbrains.kotlin.extensions.ProjectExtensionDescriptor":
                transformProjectExtensionDescriptor(cls, context);
                break;
            case "com.intellij.util.EnvironmentUtil":
                transformEnvironmentUtil(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.jvm.config.JvmContentRootsKt":
                transformJvmContentRootsKt(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.pipeline.jvm.JvmFrontendPipelinePhase":
                transformJvmFrontendPipelinePhase(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.modules.ModuleXmlParser":
                transformModuleXmlParser(cls, context);
                break;
            case "org.jetbrains.kotlin.util.slicedMap.BasicWritableSlice":
                replaceWithNull(cls, context, "initSliceDebugNames", ValueType.object("java.lang.Void"),
                        ValueType.object("java.lang.Class"));
                break;
            case "org.jetbrains.kotlin.util.ServiceLoaderLite":
                transformServiceLoaderLite(cls, context);
                break;
            case "org.jetbrains.kotlin.ir.overrides.IrOverrideChecker":
                transformIrOverrideChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.name.NameUtils":
                transformNameUtils(cls, context);
                break;
            case "org.jetbrains.kotlin.backend.common.CommonBackendErrors":
                transformCommonBackendErrors(cls, context);
                break;
            case "org.jetbrains.kotlin.backend.common.actualizer.IrExpectActualAnnotationMatchingChecker":
                transformIrExpectActualAnnotationMatchingChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.backend.common.actualizer.IrActualizerUtilsKt":
                transformIrActualizerUtilsKt(cls, context);
                break;
            case "org.jetbrains.kotlin.types.checker.NewCapturedTypeKt":
                transformNewCapturedTypeKt(cls, context);
                break;
            case "java.lang.invoke.MethodHandles":
                transformMethodHandles(cls, context);
                break;
            case "java.lang.invoke.MethodHandles$Lookup":
                transformMethodHandlesLookup(cls, context);
                break;
            case "java.lang.invoke.MethodHandle":
                transformMethodHandle(cls, context);
                break;
            case "java.lang.invoke.MethodType":
                transformMethodType(cls, context);
                break;
            case "java.nio.file.Files":
                transformFiles(cls, context);
                break;
            case "java.lang.reflect.AccessibleObject":
                transformAccessibleObject(cls, context);
                break;
            case "java.lang.reflect.Field":
                transformReflectField(cls, context);
                break;
            case "java.lang.reflect.Method":
                transformReflectMethod(cls, context);
                break;
            case "java.lang.reflect.Constructor":
                transformReflectConstructor(cls, context);
                break;
            case "java.lang.reflect.Type":
                transformReflectType(cls, context);
                break;
            case "java.util.Arrays":
                transformArrays(cls, context);
                break;
            case "java.util.Spliterators":
                transformSpliterators(cls, context);
                break;
            case "java.util.concurrent.ConcurrentHashMap":
                transformConcurrentHashMap(cls, context);
                break;
            case "java.util.ResourceBundle":
                transformResourceBundle(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.calls.checkers.AbstractReflectionApiCallChecker":
                transformAbstractReflectionApiCallChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.container.SingletonTypeComponentDescriptor":
                transformSingletonTypeComponentDescriptor(cls, context);
                break;
            case "org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl$packageFragmentProviderForWholeModuleWithDependencies$2":
                transformModuleDescriptorWholeModuleProvider(cls, context);
                break;
            case "java.util.stream.StreamSupport":
                transformStreamSupport(cls, context);
                break;
            case "org.teavm.backend.wasm.runtime.gc.WasmGCResources":
                replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
                replaceWithNull(cls, context, "getResource", ValueType.object("java.io.InputStream"),
                        ValueType.object("java.lang.String"));
                break;
            case "com.intellij.util.CachedValueBase": {
                var dataType = ValueType.object("com.intellij.util.CachedValueBase$Data");
                var resultType = ValueType.object("com.intellij.openapi.util.CachedValueProvider$Result");
                replaceWithReturnedArgument(cls, context, "cacheOrGetData", dataType, 2, dataType, dataType);
                replaceWithNoOp(cls, context, "setRawData", ValueType.VOID, dataType);
                replaceWithNull(cls, context, "getValueWithLock", ValueType.object("java.lang.Object"),
                        ValueType.object("java.lang.Object"));
                replaceWithNoOp(cls, context, "clear", ValueType.VOID);
                replaceWithNull(cls, context, "setValue", ValueType.object("java.lang.Object"), resultType);
                replaceWithNull(cls, context, "getUpToDateOrNull", dataType);
                replaceWithConstantBoolean(cls, context, "hasUpToDateValue", false);
                replaceWithConstantBoolean(cls, context, "isUpToDate", false, dataType);
                break;
            }
            case "com.intellij.util.CachedValueImpl": {
                var dataType = ValueType.object("com.intellij.util.CachedValueBase$Data");
                replaceWithNull(cls, context, "getValue", ValueType.object("java.lang.Object"));
                replaceWithNull(cls, context, "getUpToDateOrNull", dataType);
                replaceWithNull(cls, context, "getRawData", dataType);
                replaceWithNoOp(cls, context, "setData", ValueType.VOID, dataType);
                break;
            }
            case "com.intellij.lang.LanguageUtil": {
                var returnType = ValueType.object("com.intellij.lang.ParserDefinition$SpaceRequirements");
                var method = getOrCreateStaticMethod(cls, "canStickTokensTogetherByLexer", returnType,
                        ValueType.object("com.intellij.lang.ASTNode"),
                        ValueType.object("com.intellij.lang.ASTNode"),
                        ValueType.object("com.intellij.lexer.Lexer"));
                ProgramEmitter.create(method, context.getHierarchy())
                        .getField("com.intellij.lang.ParserDefinition$SpaceRequirements", "MAY", returnType)
                        .returnValue();
                break;
            }
            case "com.intellij.psi.LanguageSubstitutors":
                transformLanguageSubstitutors(cls, context);
                break;
            case "com.intellij.codeInsight.multiverse.CodeInsightContextManagerImpl":
                transformCodeInsightContextManagerImpl(cls, context);
                break;
            case "com.intellij.core.CoreApplicationEnvironment":
                transformCoreApplicationEnvironment(cls, context);
                break;
            case "com.intellij.openapi.util.SystemInfoRt":
                transformSystemInfoRt(cls, context);
                break;
            case "com.intellij.openapi.util.ObjectTree":
                transformObjectTree(cls, context);
                break;
            case "com.intellij.openapi.util.registry.Registry":
                transformRegistry(cls, context);
                break;
            case "com.intellij.openapi.util.registry.RegistryValue":
                transformRegistryValue(cls, context);
                break;
            case "com.intellij.openapi.util.Disposer":
                transformDisposer(cls, context);
                break;
            case "com.intellij.psi.tree.IStubFileElementType":
                replaceWithConstantBoolean(cls, context, "hasNonTrivialExternalId", false);
                break;
            case "com.intellij.psi.compiled.ClassFileDecompilers":
                transformClassFileDecompilers(cls, context);
                break;
            case "com.intellij.psi.impl.PsiModificationTrackerImpl":
                transformPsiModificationTrackerImpl(cls, context);
                break;
            case "com.intellij.util.containers.ContainerUtil":
                transformContainerUtil(cls, context);
                break;
            case "com.intellij.util.ExceptionUtil":
                transformExceptionUtil(cls, context);
                break;
            case "com.intellij.util.containers.Unsafe":
                transformUnsafe(cls, context);
                break;
            case "com.intellij.util.lang.UrlClassLoader":
                transformUrlClassLoader(cls, context);
                break;
            case "com.intellij.util.messages.impl.MessageBusImplKt":
                transformMessageBusImplKt(cls, context);
                break;
            case "com.intellij.mock.MockApplication":
                transformMockApplication(cls, context);
                break;
            case "com.intellij.mock.MockProject":
                transformMockProject(cls, context);
                break;
            case "com.intellij.openapi.vfs.impl.JBZipFileWrapper":
                transformJBZipFileWrapper(cls, context);
                break;
            case "com.intellij.diagnostic.ThreadDumper":
                transformThreadDumper(cls, context);
                break;
            case "com.intellij.openapi.progress.Cancellation":
                transformCancellation(cls, context);
                break;
            case "com.intellij.openapi.progress.ProgressIndicatorProvider":
                transformProgressIndicatorProvider(cls, context);
                break;
            case "com.intellij.openapi.progress.ProgressManager":
                transformProgressManager(cls, context);
                break;
            case "com.intellij.openapi.progress.impl.CoreProgressManager":
                transformCoreProgressManager(cls, context);
                break;
            case "com.intellij.openapi.application.impl.ApplicationInfoImpl":
                transformApplicationInfoImpl(cls, context);
                break;
            case "com.intellij.openapi.command.impl.CoreCommandProcessor":
                transformCoreCommandProcessor(cls, context);
                break;
            case "com.intellij.openapi.diagnostic.DefaultLogger":
                replaceWithConstantString(cls, context, "attachmentsToString",
                        ValueType.object("java.lang.Throwable"));
                break;
            case "com.intellij.openapi.vfs.impl.VirtualFileManagerImpl":
                transformVirtualFileManagerImpl(cls, context);
                break;
            case "com.intellij.openapi.vfs.DeprecatedVirtualFileSystem":
                transformDeprecatedVirtualFileSystem(cls, context);
                break;
            case "com.intellij.openapi.application.TransactionGuardImpl":
                transformTransactionGuardImpl(cls, context);
                break;
            case "com.intellij.openapi.util.LowMemoryWatcherManager":
                transformLowMemoryWatcherManager(cls, context);
                break;
            case "com.intellij.util.concurrency.AppDelayQueue":
                transformAppDelayQueue(cls, context);
                break;
            case "com.intellij.util.concurrency.AppDelayQueue$TransferThread":
                transformAppDelayQueueTransferThread(cls, context);
                break;
            case "com.intellij.util.concurrency.SchedulingWrapper$1":
                transformSchedulingWrapperShutdownTask(cls, context);
                break;
            case "com.intellij.util.concurrency.SchedulingWrapper$MyScheduledFutureTask":
                transformScheduledFutureTask(cls, context);
                break;
            case "com.intellij.util.concurrency.AppScheduledExecutorService":
                transformAppScheduledExecutorService(cls, context);
                break;
            case "com.intellij.concurrency.ThreadContext":
                transformThreadContext(cls, context);
                break;
            case "com.intellij.codeWithMe.ClientIdKt":
                transformClientIdKt(cls, context);
                break;
            case "com.intellij.util.concurrency.ThreadingAssertions":
                transformThreadingAssertions(cls, context);
                break;
            case "com.intellij.util.DebugAttachDetectorArgs":
                transformDebugAttachDetectorArgs(cls, context);
                break;
            case "com.intellij.util.ReflectionUtil":
                transformReflectionUtil(cls, context);
                break;
            case "com.intellij.ui.DummyIconManager":
                transformDummyIconManager(cls, context);
                break;
            case "com.intellij.psi.impl.ElementBase":
                transformElementBase(cls, context);
                break;
            case "com.intellij.util.ui.EDT":
                transformEdt(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.CLICompiler":
                transformCliCompiler(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.CLITool":
                replaceWithNoOp(cls, context, "disableURLConnectionCaches", ValueType.VOID);
                break;
            case "org.jetbrains.kotlin.cli.common.Usage":
                replaceWithConstantString(cls, context, "render",
                        ValueType.object("org.jetbrains.kotlin.cli.common.CLICompiler"),
                        ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonCompilerArguments"));
                break;
            case "org.jetbrains.kotlin.diagnostics.Errors$Initializer":
                transformErrorsInitializer(cls, context);
                break;
            case "org.jetbrains.kotlin.diagnostics.rendering.DefaultErrorMessages":
                transformDefaultErrorMessages(cls, context);
                break;
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactory":
                makeConstructorsPublic(cls);
                break;
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactory0":
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactory1":
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactory2":
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactory3":
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactory4":
                transformDiagnosticFactory(cls, context);
                break;
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactoryForDeprecation0":
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactoryForDeprecation1":
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactoryForDeprecation2":
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactoryForDeprecation3":
            case "org.jetbrains.kotlin.diagnostics.DiagnosticFactoryForDeprecation4":
                transformDiagnosticFactoryForDeprecation(cls, context);
                break;
            case "org.jetbrains.kotlin.container.StorageComponentContainer":
                transformStorageComponentContainer(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.BindingTraceContext":
                transformBindingTraceContext(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace":
                transformNoScopeRecordCliBindingTrace(cls, context);
                break;
            case "org.jetbrains.kotlin.container.ContainerKt":
                transformContainerKt(cls, context);
                break;
            case "org.jetbrains.kotlin.container.DslKt":
                transformDslKt(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.LazyTopDownAnalyzer":
                transformLazyTopDownAnalyzer(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.FilePreprocessor":
                transformFilePreprocessor(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.OverrideResolver":
                transformOverrideResolver(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.OverloadResolver":
                transformOverloadResolver(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.VarianceChecker":
                transformVarianceChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.BodyResolver":
                transformBodyResolver(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.FunctionDescriptorResolver":
                transformFunctionDescriptorResolver(cls, context);
                break;
            case "org.jetbrains.kotlin.codegen.FunctionCodegen":
                transformFunctionCodegen(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.AnnotationResolverImpl":
                transformAnnotationResolverImpl(cls, context);
                break;
            case "org.jetbrains.kotlin.codegen.AnnotationCodegen":
                transformAnnotationCodegen(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.JavaDescriptorResolver":
                transformJavaDescriptorResolver(cls, context);
                break;
            case "org.jetbrains.kotlin.load.kotlin.DeserializedDescriptorResolver":
                transformDeserializedDescriptorResolver(cls, context);
                break;
            case "org.jetbrains.kotlin.load.kotlin.DeserializationComponentsForJava":
                transformDeserializationComponentsForJava(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.JvmReflectionAPICallChecker":
                transformJvmReflectionApiCallChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.InterfaceDefaultMethodCallChecker":
                transformInterfaceDefaultMethodCallChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.JvmDefaultChecker":
                transformJvmDefaultChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.JvmRecordApplicabilityChecker":
                transformJvmRecordApplicabilityChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.InlinePlatformCompatibilityChecker":
                transformInlinePlatformCompatibilityChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker":
                transformJvmModuleAccessibilityChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker$ClassifierUsage":
                transformJvmModuleAccessibilityCheckerClassifierUsage(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.JvmTypeSpecificityComparator":
                transformJvmTypeSpecificityComparator(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.JvmTypeSpecificityComparatorDelegate":
                transformJvmTypeSpecificityComparatorDelegate(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.JvmPlatformOverloadsSpecificityComparator":
                transformJvmPlatformOverloadsSpecificityComparator(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.checkers.OptInMarkerDeclarationAnnotationChecker":
                transformOptInMarkerDeclarationAnnotationChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker":
                transformOptInUsageChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker$Overrides":
                transformOptInUsageCheckerOverrides(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker$ClassifierUsage":
                transformOptInUsageCheckerClassifierUsage(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.checkers.ExpectedActualDeclarationChecker":
                transformExpectedActualDeclarationChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.RepeatableAnnotationChecker":
                transformRepeatableAnnotationChecker(cls, context);
                break;
            case "org.jetbrains.kotlin.synthetic.JavaSyntheticScopes":
                transformJavaSyntheticScopes(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.jvm.compiler.KotlinCoreEnvironment$Companion": {
                replaceWithNoOp(cls, context, "registerApplicationExtensionPointsAndExtensionsFrom", ValueType.VOID,
                        ValueType.object("org.jetbrains.kotlin.config.CompilerConfiguration"),
                        ValueType.object("java.lang.String"));
                var companionType = ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.KotlinCoreEnvironment$Companion");
                var projectEnvironmentType = ValueType.object(
                        "org.jetbrains.kotlin.cli.jvm.compiler.KotlinCoreEnvironment$ProjectEnvironment");
                var compilerConfigurationType = ValueType.object("org.jetbrains.kotlin.config.CompilerConfiguration");
                var configFilesType = ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.EnvironmentConfigFiles");
                var configureProjectEnvironment = cls.getMethod(new MethodDescriptor("configureProjectEnvironment",
                        projectEnvironmentType, compilerConfigurationType, configFilesType, ValueType.VOID));
                if (configureProjectEnvironment != null) {
                    prepareMethodBody(configureProjectEnvironment);
                    var pe = ProgramEmitter.create(configureProjectEnvironment, context.getHierarchy());
                    var project = pe.var(1, projectEnvironmentType)
                            .invokeVirtual("getProject", ValueType.object("com.intellij.mock.MockProject"));
                    project.invokeVirtual("registerService", ValueType.VOID,
                            pe.constant(org.jetbrains.kotlin.load.kotlin.ModuleVisibilityManager.class),
                            pe.construct("org.jetbrains.kotlin.cli.common.CliModuleVisibilityManagerImpl",
                                    pe.defaultValue(ValueType.BOOLEAN)).cast(ValueType.object("java.lang.Object")));
                    pe.var(0, companionType).invokeVirtual("registerProjectServicesForCLI", ValueType.VOID,
                            pe.var(1, projectEnvironmentType)
                                    .cast(ValueType.object("com.intellij.core.JavaCoreProjectEnvironment")));
                    pe.var(0, companionType).invokeVirtual("registerProjectServices", ValueType.VOID, project);
                    pe.exit();
                }
                break;
            }
            case "org.jetbrains.kotlin.cli.jvm.compiler.KotlinCoreEnvironment$ProjectEnvironment":
                replaceWithNoOp(cls, context, "registerExtensionsFromPlugins", ValueType.VOID,
                        ValueType.object("org.jetbrains.kotlin.config.CompilerConfiguration"));
                break;
            case "org.jetbrains.kotlin.KotlinElementTypeProvider$Companion":
                transformKotlinElementTypeProviderCompanion(cls, context);
                break;
            case "org.jetbrains.kotlin.KtNodeType":
                transformKtNodeType(cls, context);
                break;
            case "org.jetbrains.kotlin.config.KotlinCompilerVersion": {
                var owner = "org.jetbrains.kotlin.config.KotlinCompilerVersion";
                var clinit = getOrCreateStaticMethod(cls, "<clinit>", ValueType.VOID);
                var pe = ProgramEmitter.create(clinit, context.getHierarchy());
                pe.setField(owner, "VERSION", pe.constant("1.9.24"));
                if (cls.getField("IS_PRE_RELEASE") != null) {
                    pe.setField(owner, "IS_PRE_RELEASE", pe.constant(0));
                }
                pe.exit();

                var getVersion = getOrCreateStaticMethod(cls, "getVersion", ValueType.object("java.lang.String"));
                ProgramEmitter.create(getVersion, context.getHierarchy())
                        .constant("1.9.24")
                        .returnValue();
                replaceWithConstantBoolean(cls, context, "isPreRelease", false);
                break;
            }
            case "org.jetbrains.kotlin.cli.jvm.compiler.CompileEnvironmentUtil":
                transformCompileEnvironmentUtil(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.jvm.compiler.jarfs.FastJarFileSystem":
                transformFastJarFileSystem(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.jvm.compiler.jarfs.FastJarHandler":
                transformFastJarHandler(cls, context);
                break;
            case "org.jetbrains.kotlin.javac.JavacWrapper":
                transformJavacWrapper(cls, context);
                break;
            case "org.jetbrains.kotlin.javac.components.JavacBasedClassFinder":
                transformJavacBasedClassFinder(cls, context);
                break;
            case "org.jetbrains.kotlin.load.java.AbstractJavaClassFinder":
                transformAbstractJavaClassFinder(cls, context);
                break;
            case "org.jetbrains.kotlin.load.java.JavaClassFinderImpl":
                transformJavaClassFinderImpl(cls, context);
                break;
            case "org.jetbrains.kotlin.util.PerformanceManager":
                transformPerformanceManager(cls, context);
                break;
        }
    }

    private void submitSyntheticClasses(ClassHolderTransformerContext context) {
        submitSyntheticIcon(context);
        submitSyntheticScheduledExecutorService(context);
        submitSyntheticRunnableScheduledFuture(context);
        submitSyntheticAbstractExecutorService(context);
        submitSyntheticFileAttributeView(context);
        submitSyntheticBasicFileAttributeView(context);
        submitSyntheticPosixFileAttributes(context);
        submitSyntheticDosFileAttributes(context);
    }

    private void submitSyntheticIcon(ClassHolderTransformerContext context) {
        if (!SUBMITTED_SYNTHETIC_CLASSES.add("javax.swing.Icon")
                || context.getHierarchy().getClassSource().get("javax.swing.Icon") != null) {
            return;
        }
        var cls = new ClassHolder("javax.swing.Icon");
        cls.setLevel(AccessLevel.PUBLIC);
        cls.getModifiers().add(ElementModifier.INTERFACE);
        cls.getModifiers().add(ElementModifier.ABSTRACT);
        addAbstractMethod(cls, "paintIcon", ValueType.VOID,
                ValueType.object("java.awt.Component"), ValueType.object("java.awt.Graphics"),
                ValueType.INTEGER, ValueType.INTEGER);
        addAbstractMethod(cls, "getIconWidth", ValueType.INTEGER);
        addAbstractMethod(cls, "getIconHeight", ValueType.INTEGER);
        context.submit(cls);
    }

    private void submitSyntheticScheduledExecutorService(ClassHolderTransformerContext context) {
        if (!SUBMITTED_SYNTHETIC_CLASSES.add("java.util.concurrent.ScheduledExecutorService")
                || context.getHierarchy().getClassSource().get("java.util.concurrent.ScheduledExecutorService")
                        != null) {
            return;
        }
        var cls = new ClassHolder("java.util.concurrent.ScheduledExecutorService");
        cls.setLevel(AccessLevel.PUBLIC);
        cls.getModifiers().add(ElementModifier.INTERFACE);
        cls.getModifiers().add(ElementModifier.ABSTRACT);
        cls.getInterfaces().add("java.util.concurrent.ExecutorService");
        addAbstractMethod(cls, "schedule", ValueType.object("java.util.concurrent.ScheduledFuture"),
                ValueType.object("java.lang.Runnable"), ValueType.LONG,
                ValueType.object("java.util.concurrent.TimeUnit"));
        addAbstractMethod(cls, "schedule", ValueType.object("java.util.concurrent.ScheduledFuture"),
                ValueType.object("java.util.concurrent.Callable"), ValueType.LONG,
                ValueType.object("java.util.concurrent.TimeUnit"));
        addAbstractMethod(cls, "scheduleAtFixedRate", ValueType.object("java.util.concurrent.ScheduledFuture"),
                ValueType.object("java.lang.Runnable"), ValueType.LONG, ValueType.LONG,
                ValueType.object("java.util.concurrent.TimeUnit"));
        addAbstractMethod(cls, "scheduleWithFixedDelay", ValueType.object("java.util.concurrent.ScheduledFuture"),
                ValueType.object("java.lang.Runnable"), ValueType.LONG, ValueType.LONG,
                ValueType.object("java.util.concurrent.TimeUnit"));
        context.submit(cls);
    }

    private void submitSyntheticRunnableScheduledFuture(ClassHolderTransformerContext context) {
        if (!SUBMITTED_SYNTHETIC_CLASSES.add("java.util.concurrent.RunnableScheduledFuture")
                || context.getHierarchy().getClassSource().get("java.util.concurrent.RunnableScheduledFuture")
                        != null) {
            return;
        }
        var cls = new ClassHolder("java.util.concurrent.RunnableScheduledFuture");
        cls.setLevel(AccessLevel.PUBLIC);
        cls.getModifiers().add(ElementModifier.INTERFACE);
        cls.getModifiers().add(ElementModifier.ABSTRACT);
        cls.getInterfaces().add("java.util.concurrent.RunnableFuture");
        cls.getInterfaces().add("java.util.concurrent.ScheduledFuture");
        addAbstractMethod(cls, "isPeriodic", ValueType.BOOLEAN);
        context.submit(cls);
    }

    private void submitSyntheticAbstractExecutorService(ClassHolderTransformerContext context) {
        if (!SUBMITTED_SYNTHETIC_CLASSES.add("java.util.concurrent.AbstractExecutorService")
                || context.getHierarchy().getClassSource().get("java.util.concurrent.AbstractExecutorService")
                        != null) {
            return;
        }
        var cls = new ClassHolder("java.util.concurrent.AbstractExecutorService");
        cls.setLevel(AccessLevel.PUBLIC);
        cls.getModifiers().add(ElementModifier.ABSTRACT);
        cls.getInterfaces().add("java.util.concurrent.ExecutorService");
        var constructor = new MethodHolder(new MethodDescriptor("<init>", ValueType.VOID));
        constructor.setLevel(AccessLevel.PUBLIC);
        cls.addMethod(constructor);
        var pe = ProgramEmitter.create(constructor, context.getHierarchy());
        pe.var(0, ValueType.object("java.util.concurrent.AbstractExecutorService"))
                .invokeSpecial(Object.class, "<init>");
        pe.exit();
        context.submit(cls);
    }

    private void submitSyntheticBasicFileAttributeView(ClassHolderTransformerContext context) {
        if (!SUBMITTED_SYNTHETIC_CLASSES.add("java.nio.file.attribute.BasicFileAttributeView")
                || context.getHierarchy().getClassSource().get("java.nio.file.attribute.BasicFileAttributeView")
                        != null) {
            return;
        }
        var cls = new ClassHolder("java.nio.file.attribute.BasicFileAttributeView");
        cls.setLevel(AccessLevel.PUBLIC);
        cls.getModifiers().add(ElementModifier.INTERFACE);
        cls.getModifiers().add(ElementModifier.ABSTRACT);
        cls.getInterfaces().add("java.nio.file.attribute.FileAttributeView");
        addAbstractMethod(cls, "setTimes", ValueType.VOID,
                ValueType.object("java.nio.file.attribute.FileTime"),
                ValueType.object("java.nio.file.attribute.FileTime"),
                ValueType.object("java.nio.file.attribute.FileTime"));
        context.submit(cls);
    }

    private void submitSyntheticFileAttributeView(ClassHolderTransformerContext context) {
        if (!SUBMITTED_SYNTHETIC_CLASSES.add("java.nio.file.attribute.FileAttributeView")
                || context.getHierarchy().getClassSource().get("java.nio.file.attribute.FileAttributeView")
                        != null) {
            return;
        }
        var cls = new ClassHolder("java.nio.file.attribute.FileAttributeView");
        cls.setLevel(AccessLevel.PUBLIC);
        cls.getModifiers().add(ElementModifier.INTERFACE);
        cls.getModifiers().add(ElementModifier.ABSTRACT);
        addAbstractMethod(cls, "isHidden", ValueType.BOOLEAN);
        addAbstractMethod(cls, "isReadOnly", ValueType.BOOLEAN);
        context.submit(cls);
    }

    private void submitSyntheticPosixFileAttributes(ClassHolderTransformerContext context) {
        if (!SUBMITTED_SYNTHETIC_CLASSES.add("java.nio.file.attribute.PosixFileAttributes")
                || context.getHierarchy().getClassSource().get("java.nio.file.attribute.PosixFileAttributes")
                        != null) {
            return;
        }
        var cls = new ClassHolder("java.nio.file.attribute.PosixFileAttributes");
        cls.setLevel(AccessLevel.PUBLIC);
        cls.getModifiers().add(ElementModifier.INTERFACE);
        cls.getModifiers().add(ElementModifier.ABSTRACT);
        context.submit(cls);
    }

    private void submitSyntheticDosFileAttributes(ClassHolderTransformerContext context) {
        if (!SUBMITTED_SYNTHETIC_CLASSES.add("java.nio.file.attribute.DosFileAttributes")
                || context.getHierarchy().getClassSource().get("java.nio.file.attribute.DosFileAttributes")
                        != null) {
            return;
        }
        var cls = new ClassHolder("java.nio.file.attribute.DosFileAttributes");
        cls.setLevel(AccessLevel.PUBLIC);
        cls.getModifiers().add(ElementModifier.INTERFACE);
        cls.getModifiers().add(ElementModifier.ABSTRACT);
        context.submit(cls);
    }

    private static void addAbstractMethod(ClassHolder cls, String name, ValueType returnType,
            ValueType... argumentTypes) {
        var method = new MethodHolder(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        method.setLevel(AccessLevel.PUBLIC);
        method.getModifiers().add(ElementModifier.ABSTRACT);
        cls.addMethod(method);
    }

    private static void stripClassAnnotations(ClassHolder cls) {
        stripAnnotations(cls.getAnnotations());
    }

    private static void stripMemberAnnotations(ClassHolder cls) {
        stripAnnotations(cls.getAnnotations());
        for (var method : cls.getMethods()) {
            stripAnnotations(method.getAnnotations());
            for (var annotations : method.getParameterAnnotations()) {
                stripAnnotations(annotations);
            }
        }
        for (var field : cls.getFields()) {
            stripAnnotations(field.getAnnotations());
        }
    }

    private static void stripAnnotations(org.teavm.model.AnnotationContainer annotations) {
        var annotationTypes = new java.util.ArrayList<String>();
        for (var annotation : annotations.all()) {
            var type = annotation.getType();
            if (!type.startsWith("org.teavm.jso.")) {
                annotationTypes.add(type);
            }
        }
        for (var annotationType : annotationTypes) {
            annotations.remove(annotationType);
        }
    }

    private void transformLangClass(ClassHolder cls, ClassHolderTransformerContext context) {
        var resource = getOrCreateMethod(cls, "getResource", ValueType.object("java.net.URL"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(resource, context.getHierarchy())
                .constantNull(ValueType.object("java.net.URL"))
                .returnValue();

        var typeName = getOrCreateMethod(cls, "getTypeName", ValueType.object("java.lang.String"));
        ProgramEmitter.create(typeName, context.getHierarchy())
                .var(0, ValueType.object("java.lang.Class"))
                .invokeVirtual("getName", ValueType.object("java.lang.String"))
                .returnValue();

        var genericInterfacesType = ValueType.arrayOf(ValueType.object("java.lang.reflect.Type"));
        var genericInterfaces = getOrCreateMethod(cls, "getGenericInterfaces", genericInterfacesType);
        ProgramEmitter.create(genericInterfaces, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.reflect.Type"), 0)
                .returnValue();

        var genericSuperclass = getOrCreateMethod(cls, "getGenericSuperclass",
                ValueType.object("java.lang.reflect.Type"));
        ProgramEmitter.create(genericSuperclass, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.reflect.Type"))
                .returnValue();

        var declaredClassesType = ValueType.arrayOf(ValueType.object("java.lang.Class"));
        var declaredClasses = getOrCreateMethod(cls, "getDeclaredClasses", declaredClassesType);
        ProgramEmitter.create(declaredClasses, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.Class"), 0)
                .returnValue();

        var fieldArrayType = ValueType.arrayOf(ValueType.object("java.lang.reflect.Field"));
        var declaredFields = getOrCreateMethod(cls, "getDeclaredFields", fieldArrayType);
        ProgramEmitter.create(declaredFields, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.reflect.Field"), 0)
                .returnValue();

        var fields = getOrCreateMethod(cls, "getFields", fieldArrayType);
        ProgramEmitter.create(fields, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.reflect.Field"), 0)
                .returnValue();

        var classArrayType = ValueType.arrayOf(ValueType.object("java.lang.Class"));
        var declaredMethod = getOrCreateMethod(cls, "getDeclaredMethod",
                ValueType.object("java.lang.reflect.Method"),
                ValueType.object("java.lang.String"), classArrayType);
        ProgramEmitter.create(declaredMethod, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.reflect.Method"))
                .returnValue();

        var methodArrayType = ValueType.arrayOf(ValueType.object("java.lang.reflect.Method"));
        var declaredMethods = getOrCreateMethod(cls, "getDeclaredMethods", methodArrayType);
        ProgramEmitter.create(declaredMethods, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.reflect.Method"), 0)
                .returnValue();

        var methods = getOrCreateMethod(cls, "getMethods", methodArrayType);
        ProgramEmitter.create(methods, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.reflect.Method"), 0)
                .returnValue();

        var method = getOrCreateMethod(cls, "getMethod",
                ValueType.object("java.lang.reflect.Method"),
                ValueType.object("java.lang.String"), classArrayType);
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.reflect.Method"))
                .returnValue();

        var isAnonymousClass = getOrCreateMethod(cls, "isAnonymousClass", ValueType.BOOLEAN);
        ProgramEmitter.create(isAnonymousClass, context.getHierarchy()).constant(0).returnValue();
    }

    private void transformString(ClassHolder cls, ClassHolderTransformerContext context) {
        var objectArrayType = ValueType.arrayOf(ValueType.object("java.lang.Object"));
        var method = getOrCreateStaticMethod(cls, "format", ValueType.object("java.lang.String"),
                ValueType.object("java.lang.String"), objectArrayType);
        ProgramEmitter.create(method, context.getHierarchy())
                .var(1, ValueType.object("java.lang.String"))
                .returnValue();

        method = getOrCreateStaticMethod(cls, "format", ValueType.object("java.lang.String"),
                ValueType.object("java.util.Locale"), ValueType.object("java.lang.String"), objectArrayType);
        ProgramEmitter.create(method, context.getHierarchy())
                .var(2, ValueType.object("java.lang.String"))
                .returnValue();

        var stringType = ValueType.object("java.lang.String");
        replaceWithReturnedArgument(cls, context, "toLowerCase", stringType, 0);
        replaceWithReturnedArgument(cls, context, "toLowerCase", stringType, 0,
                ValueType.object("java.util.Locale"));
        replaceWithReturnedArgument(cls, context, "toUpperCase", stringType, 0);
        replaceWithReturnedArgument(cls, context, "toUpperCase", stringType, 0,
                ValueType.object("java.util.Locale"));
    }

    private void transformCharacter(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithReturnedArgument(cls, context, "mapChar", ValueType.INTEGER, 2,
                ValueType.object("org.teavm.classlib.impl.unicode.CharMapping"), ValueType.INTEGER);

        replaceWithNull(cls, context, "getLowerCaseMapping",
                ValueType.object("org.teavm.classlib.impl.unicode.CharMapping"));
        replaceWithNull(cls, context, "getUpperCaseMapping",
                ValueType.object("org.teavm.classlib.impl.unicode.CharMapping"));
        replaceWithNull(cls, context, "getTitleCaseMapping",
                ValueType.object("org.teavm.classlib.impl.unicode.CharMapping"));
        replaceWithNull(cls, context, "acquireLowerCaseMapping",
                ValueType.object("org.teavm.platform.metadata.StringResource"));
        replaceWithNull(cls, context, "acquireUpperCaseMapping",
                ValueType.object("org.teavm.platform.metadata.StringResource"));
        replaceWithNull(cls, context, "acquireTitleCaseMapping",
                ValueType.object("org.teavm.platform.metadata.StringResource"));
        replaceWithEmptyIntArray(cls, context, "getDigitMapping");
        replaceWithNull(cls, context, "obtainDigitMapping",
                ValueType.object("org.teavm.platform.metadata.StringResource"));
        var rangeArrayType = ValueType.arrayOf(
                ValueType.object("org.teavm.classlib.impl.unicode.UnicodeHelper$Range"));
        var getClasses = cls.getMethod(new MethodDescriptor("getClasses", rangeArrayType));
        if (getClasses != null) {
            prepareMethodBody(getClasses);
            ProgramEmitter.create(getClasses, context.getHierarchy())
                    .constructArray(ValueType.object("org.teavm.classlib.impl.unicode.UnicodeHelper$Range"), 0)
                    .returnValue();
        }
        replaceWithNull(cls, context, "obtainClasses",
                ValueType.object("org.teavm.platform.metadata.StringResource"));
    }

    private void transformCharset(ClassHolder cls, ClassHolderTransformerContext context) {
        var charsetType = ValueType.object("java.nio.charset.Charset");
        var method = getOrCreateStaticMethod(cls, "forName", charsetType,
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .getField("java.nio.charset.StandardCharsets", "UTF_8", charsetType)
                .returnValue();
        replaceWithConstantBoolean(cls, context, "isSupported", true, ValueType.object("java.lang.String"));
    }

    private void transformMessageFormat(ClassHolder cls, ClassHolderTransformerContext context) {
        var stringType = ValueType.object("java.lang.String");
        var objectType = ValueType.object("java.lang.Object");
        var objectArrayType = ValueType.arrayOf(objectType);
        var stringBufferType = ValueType.object("java.lang.StringBuffer");
        var fieldPositionType = ValueType.object("java.text.FieldPosition");
        var formatType = ValueType.object("java.text.Format");
        var formatArrayType = ValueType.arrayOf(formatType);
        var parsePositionType = ValueType.object("java.text.ParsePosition");
        var localeType = ValueType.object("java.util.Locale");
        var attributedIteratorType = ValueType.object("java.text.AttributedCharacterIterator");
        var messageFormatType = ValueType.object("java.text.MessageFormat");

        replaceMessageFormatConstructor(cls, context, stringType);
        replaceMessageFormatConstructor(cls, context, stringType, localeType);
        replaceWithNoOp(cls, context, "applyPattern", ValueType.VOID, stringType);
        replaceWithReturnedArgument(cls, context, "clone", objectType, 0);
        replaceWithConstantBoolean(cls, context, "equals", false, objectType);
        replaceWithNull(cls, context, "formatToCharacterIterator", attributedIteratorType, objectType);
        replaceWithReturnedArgument(cls, context, "format", stringBufferType, 2,
                objectArrayType, stringBufferType, fieldPositionType);
        replaceWithReturnedArgument(cls, context, "format", stringBufferType, 2,
                objectType, stringBufferType, fieldPositionType);
        replaceWithReturnedArgument(cls, context, "format", stringType, 0, stringType, objectArrayType);
        replaceWithEmptyFormatArray(cls, context, "getFormats");
        replaceWithEmptyFormatArray(cls, context, "getFormatsByArgumentIndex");
        replaceWithNoOp(cls, context, "setFormatByArgumentIndex", ValueType.VOID, ValueType.INTEGER, formatType);
        replaceWithNoOp(cls, context, "setFormatsByArgumentIndex", ValueType.VOID, formatArrayType);
        replaceWithRootLocale(cls, context, "getLocale");
        replaceWithConstantInt(cls, context, "hashCode", 0);
        replaceWithEmptyObjectArray(cls, context, "parse", stringType);
        replaceWithEmptyObjectArray(cls, context, "parse", stringType, parsePositionType);
        replaceWithNull(cls, context, "parseObject", objectType, stringType, parsePositionType);
        replaceWithNoOp(cls, context, "setFormat", ValueType.VOID, ValueType.INTEGER, formatType);
        replaceWithNoOp(cls, context, "setFormats", ValueType.VOID, formatArrayType);
        replaceWithNoOp(cls, context, "setLocale", ValueType.VOID, localeType);
        replaceWithConstantString(cls, context, "toPattern");
        replaceWithReturnedArgument(cls, context, "formatImpl", stringBufferType, 2,
                objectArrayType, stringBufferType, fieldPositionType, ValueType.object("java.util.List"));
        replaceWithNoOp(cls, context, "handleArgumentField", ValueType.VOID,
                ValueType.INTEGER, ValueType.INTEGER, ValueType.INTEGER, fieldPositionType,
                ValueType.object("java.util.List"));
        replaceWithNoOp(cls, context, "handleformat", ValueType.VOID,
                formatType, objectType, ValueType.INTEGER, ValueType.object("java.util.List"));
        replaceWithNull(cls, context, "parseVariable", formatType, stringType, parsePositionType);
        replaceWithConstantInt(cls, context, "match", -1,
                stringType, parsePositionType, ValueType.BOOLEAN, ValueType.arrayOf(stringType));
        replaceWithConstantString(cls, context, "decodeDecimalFormat",
                stringBufferType, formatType);
        replaceWithConstantString(cls, context, "decodeSimpleDateFormat",
                stringBufferType, formatType);
        replaceWithNoOp(cls, context, "appendQuoted", ValueType.VOID, stringBufferType, stringType);

        var clinit = cls.getMethod(new MethodDescriptor("<clinit>", ValueType.VOID));
        if (clinit != null) {
            prepareMethodBody(clinit);
            ProgramEmitter.create(clinit, context.getHierarchy()).exit();
        }
    }

    private void transformWeakReference(ClassHolder cls, ClassHolderTransformerContext context) {
        var objectType = ValueType.object("java.lang.Object");
        var weakReferenceType = ValueType.object(cls.getName());
        var teavmClasslibName = cls.getName().startsWith("org.teavm.classlib.");
        var referenceType = teavmClasslibName
                ? "org.teavm.classlib.java.lang.ref.TReference" : "java.lang.ref.Reference";
        var queueType = ValueType.object(teavmClasslibName
                ? "org.teavm.classlib.java.lang.ref.TReferenceQueue" : "java.lang.ref.ReferenceQueue");

        var constructor = cls.getMethod(new MethodDescriptor("<init>", objectType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, weakReferenceType).invokeSpecial(referenceType, "<init>");
            pe.exit();
        }

        constructor = cls.getMethod(new MethodDescriptor("<init>", objectType, queueType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, weakReferenceType).invokeSpecial(referenceType, "<init>");
            pe.exit();
        }

        var method = getOrCreateMethod(cls, "get", objectType);
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(objectType)
                .returnValue();
        replaceWithNoOp(cls, context, "clear", ValueType.VOID);
        replaceWithConstantBoolean(cls, context, "isEnqueued", false);
        replaceWithConstantBoolean(cls, context, "enqueue", true);
    }

    private void replaceMessageFormatConstructor(ClassHolder cls, ClassHolderTransformerContext context,
            ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor("<init>", appendReturnType(ValueType.VOID, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .var(0, ValueType.object("java.text.MessageFormat"))
                .invokeSpecial("java.text.Format", "<init>")
                .exit();
    }

    private void transformBundleBase(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("postprocessValue",
                ValueType.object("java.util.ResourceBundle"),
                ValueType.object("java.lang.String"),
                ValueType.arrayOf(ValueType.object("java.lang.Object")),
                ValueType.object("java.lang.String")));
        if (method != null) {
            prepareMethodBody(method);
            ProgramEmitter.create(method, context.getHierarchy())
                    .var(2, ValueType.object("java.lang.String"))
                    .returnValue();
        }
    }

    private void transformOrdinalFormat(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "apply", ValueType.VOID, ValueType.object("java.text.MessageFormat"));
        replaceWithNull(cls, context, "getOrdinalFormat", ValueType.object("java.text.NumberFormat"),
                ValueType.object("java.util.Locale"));
        replaceWithConstantString(cls, context, "formatEnglish", ValueType.LONG);
    }

    private void transformCallableReference(ClassHolder cls, ClassHolderTransformerContext context) {
        var callableType = ValueType.object("kotlin.reflect.KCallable");
        replaceWithReturnedArgument(cls, context, "compute", callableType, 0);
        replaceWithReturnedArgument(cls, context, "getReflected", callableType, 0);
        replaceWithEmptyList(cls, context, "getParameters");
        replaceWithEmptyList(cls, context, "getAnnotations");
        replaceWithEmptyList(cls, context, "getTypeParameters");
        replaceWithNull(cls, context, "getReturnType", ValueType.object("kotlin.reflect.KType"));
        replaceWithNull(cls, context, "call", ValueType.object("java.lang.Object"),
                ValueType.arrayOf(ValueType.object("java.lang.Object")));
        replaceWithNull(cls, context, "callBy", ValueType.object("java.lang.Object"),
                ValueType.object("java.util.Map"));
        replaceWithNull(cls, context, "getVisibility", ValueType.object("kotlin.reflect.KVisibility"));
        replaceWithConstantBoolean(cls, context, "isFinal", false);
        replaceWithConstantBoolean(cls, context, "isOpen", false);
        replaceWithConstantBoolean(cls, context, "isAbstract", false);
        replaceWithConstantBoolean(cls, context, "isSuspend", false);
    }

    private void transformClassReference(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithEmptyCollection(cls, context, "getMembers");
        replaceWithEmptyCollection(cls, context, "getConstructors");
        replaceWithEmptyCollection(cls, context, "getNestedClasses");
        replaceWithEmptyList(cls, context, "getAnnotations");
        replaceWithEmptyList(cls, context, "getTypeParameters");
        replaceWithEmptyList(cls, context, "getSupertypes");
        replaceWithEmptyList(cls, context, "getSealedSubclasses");
        replaceWithNull(cls, context, "getObjectInstance", ValueType.object("java.lang.Object"));
        replaceWithNull(cls, context, "getVisibility", ValueType.object("kotlin.reflect.KVisibility"));
        replaceWithConstantBoolean(cls, context, "isFinal", false);
        replaceWithConstantBoolean(cls, context, "isOpen", false);
        replaceWithConstantBoolean(cls, context, "isAbstract", false);
        replaceWithConstantBoolean(cls, context, "isSealed", false);
        replaceWithConstantBoolean(cls, context, "isData", false);
        replaceWithConstantBoolean(cls, context, "isInner", false);
        replaceWithConstantBoolean(cls, context, "isCompanion", false);
        replaceWithConstantBoolean(cls, context, "isFun", false);
        replaceWithConstantBoolean(cls, context, "isValue", false);
    }

    private void transformClassLoader(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "getSystemResource", ValueType.object("java.net.URL"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.net.URL"))
                .returnValue();

        method = getOrCreateMethod(cls, "getResource", ValueType.object("java.net.URL"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.net.URL"))
                .returnValue();

        method = getOrCreateMethod(cls, "loadClass", ValueType.object("java.lang.Class"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.Class"))
                .returnValue();

        method = getOrCreateMethod(cls, "findLoadedClass", ValueType.object("java.lang.Class"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.Class"))
                .returnValue();
    }

    private void transformFile(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "toPath", ValueType.object("java.nio.file.Path"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.nio.file.Path"))
                .returnValue();

        method = getOrCreateMethod(cls, "canExecute", ValueType.BOOLEAN);
        ProgramEmitter.create(method, context.getHierarchy()).constant(0).returnValue();

        method = getOrCreateMethod(cls, "setReadable", ValueType.BOOLEAN, ValueType.BOOLEAN);
        ProgramEmitter.create(method, context.getHierarchy()).constant(1).returnValue();
    }

    private void transformLong(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "parseUnsignedLong", ValueType.LONG,
                ValueType.object("java.lang.String"), ValueType.INTEGER);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("java.lang.Long", "parseLong", ValueType.LONG,
                pe.var(1, ValueType.object("java.lang.String")), pe.var(2, ValueType.INTEGER))
                .returnValue();
    }

    private void transformInteger(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "sum", ValueType.INTEGER, ValueType.INTEGER, ValueType.INTEGER);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.constant(0).returnValue();
    }

    private void transformLocale(ClassHolder cls, ClassHolderTransformerContext context) {
        var localeType = ValueType.object("java.util.Locale");
        var stringType = ValueType.object("java.lang.String");

        var clinit = getOrCreateStaticMethod(cls, "<clinit>", ValueType.VOID);
        var pe = ProgramEmitter.create(clinit, context.getHierarchy());
        var owner = "java.util.Locale";
        String[][] locales = {
                { "CANADA", "en", "CA" },
                { "CANADA_FRENCH", "fr", "CA" },
                { "CHINA", "zh", "CN" },
                { "CHINESE", "zh", "" },
                { "ENGLISH", "en", "" },
                { "FRANCE", "fr", "FR" },
                { "FRENCH", "fr", "" },
                { "GERMAN", "de", "" },
                { "GERMANY", "de", "DE" },
                { "ITALIAN", "it", "" },
                { "ITALY", "it", "IT" },
                { "JAPAN", "ja", "JP" },
                { "JAPANESE", "ja", "" },
                { "KOREA", "ko", "KR" },
                { "KOREAN", "ko", "" },
                { "PRC", "zh", "CN" },
                { "SIMPLIFIED_CHINESE", "zh", "CN" },
                { "TAIWAN", "zh", "TW" },
                { "TRADITIONAL_CHINESE", "zh", "TW" },
                { "UK", "en", "GB" },
                { "US", "en", "US" },
                { "ROOT", "", "" }
        };
        for (var locale : locales) {
            if (cls.getField(locale[0]) != null) {
                pe.setField(owner, locale[0],
                        pe.construct(owner, pe.constant(locale[1]), pe.constant(locale[2])));
            }
        }
        if (cls.getField("defaultLocale") != null) {
            pe.setField(owner, "defaultLocale", pe.construct(owner, pe.constant("en"), pe.constant("US")));
        }
        if (cls.getField("availableLocales") != null) {
            pe.setField(owner, "availableLocales", pe.constructArray(localeType, 0));
        }
        pe.exit();

        var method = getOrCreateStaticMethod(cls, "forLanguageTag", localeType,
                stringType);
        pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct(owner, pe.constant("en"), pe.constant("")).returnValue();

        method = getOrCreateStaticMethod(cls, "getDefault", localeType);
        pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct(owner, pe.constant("en"), pe.constant("US")).returnValue();

        method = getOrCreateStaticMethod(cls, "getAvailableLocales", ValueType.arrayOf(localeType));
        ProgramEmitter.create(method, context.getHierarchy())
                .constructArray(localeType, 0)
                .returnValue();

        replaceWithReturnedArgument(cls, context, "getDisplayCountry", stringType, 1, stringType, stringType);
        replaceWithReturnedArgument(cls, context, "getDisplayLanguage", stringType, 1, stringType, stringType);
    }

    private void transformRuntime(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "addShutdownHook", ValueType.VOID,
                ValueType.object("java.lang.Thread"));
        ProgramEmitter.create(method, context.getHierarchy()).exit();

        method = getOrCreateMethod(cls, "exec", ValueType.object("java.lang.Process"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.Process"))
                .returnValue();
    }

    private void transformSystem(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "exit", ValueType.VOID, ValueType.INTEGER);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct(IllegalStateException.class, pe.constant("System.exit is not available in wasm-idle"))
                .raise();

        method = getOrCreateStaticMethod(cls, "mapLibraryName", ValueType.object("java.lang.String"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .var(0, ValueType.object("java.lang.String"))
                .returnValue();

        method = getOrCreateStaticMethod(cls, "load", ValueType.VOID, ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy()).exit();

        method = getOrCreateStaticMethod(cls, "loadLibrary", ValueType.VOID, ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy()).exit();

        method = getOrCreateStaticMethod(cls, "getenv", ValueType.object("java.util.Map"));
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke("java.util.Collections", "emptyMap", ValueType.object("java.util.Map"))
                .returnValue();

        method = getOrCreateStaticMethod(cls, "getenv", ValueType.object("java.lang.String"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.String"))
                .returnValue();
        replaceWithSimpleArrayCopy(cls, context, "arraycopy");
        replaceWithSimpleArrayCopy(cls, context, "arrayCopyImpl");
    }

    private void replaceWithSimpleArrayCopy(ClassHolder cls, ClassHolderTransformerContext context, String name) {
        var method = cls.getMethod(new MethodDescriptor(name,
                ValueType.object("java.lang.Object"), ValueType.INTEGER, ValueType.object("java.lang.Object"),
                ValueType.INTEGER, ValueType.INTEGER, ValueType.VOID));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("org.wasmidle.kotlin.teavm.SimpleArrayCopy", "copy", ValueType.VOID,
                pe.var(1, ValueType.object("java.lang.Object")),
                pe.var(2, ValueType.INTEGER),
                pe.var(3, ValueType.object("java.lang.Object")),
                pe.var(4, ValueType.INTEGER),
                pe.var(5, ValueType.INTEGER));
        pe.exit();
    }

    private void transformFileSystemUtil(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "<clinit>", ValueType.VOID);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        var owner = "com.intellij.openapi.util.io.FileSystemUtil";
        if (cls.getField("DO_NOT_RESOLVE_SYMLINKS") != null) {
            pe.setField(owner, "DO_NOT_RESOLVE_SYMLINKS", pe.constant(1));
        }
        if (cls.getField("LOG") != null) {
            pe.setField(owner, "LOG", pe.constantNull(ValueType.object("com.intellij.openapi.diagnostic.Logger")));
        }
        if (cls.getField("ourMediator") != null) {
            pe.setField(owner, "ourMediator",
                    pe.constantNull(ValueType.object("com.intellij.openapi.util.io.FileSystemUtil$Mediator")));
        }
        if (cls.getField("ourLibExt2FsPresent") != null) {
            pe.setField(owner, "ourLibExt2FsPresent", pe.constant(0));
        }
        pe.exit();

        replaceWithNull(cls, context, "computeMediator",
                ValueType.object("com.intellij.openapi.util.io.FileSystemUtil$Mediator"));
        replaceWithReturnedArgument(cls, context, "check",
                ValueType.object("com.intellij.openapi.util.io.FileSystemUtil$Mediator"), 0,
                ValueType.object("com.intellij.openapi.util.io.FileSystemUtil$Mediator"));
        replaceWithNull(cls, context, "getAttributes",
                ValueType.object("com.intellij.openapi.util.io.FileAttributes"),
                ValueType.object("java.lang.String"));
        replaceWithConstantBoolean(cls, context, "isSymLink", false, ValueType.object("java.lang.String"));
        replaceWithConstantBoolean(cls, context, "isSymLink", false, ValueType.object("java.io.File"));
        replaceWithConstantBoolean(cls, context, "clonePermissionsToExecute", false,
                ValueType.object("java.lang.String"), ValueType.object("java.lang.String"));
        replaceWithNull(cls, context, "access$200",
                ValueType.object("com.intellij.openapi.diagnostic.Logger"));
    }

    private void transformCLDRHelper(ClassHolder cls, ClassHolderTransformerContext context) {
        stripMemberAnnotations(cls);

        var stringType = ValueType.object("java.lang.String");
        var resourceMapType = ValueType.object("org.teavm.platform.metadata.ResourceMap");
        var stringResourceType = ValueType.object("org.teavm.platform.metadata.StringResource");
        var resourceArrayType = ValueType.object("org.teavm.platform.metadata.ResourceArray");

        createConstantStringMethod(cls, context, "getLikelySubtags", "en", stringType);
        createConstantStringMethod(cls, context, "resolveCountry", "", stringType, stringType);
        createEmptyStringArrayMethod(cls, context, "resolveEras", stringType, stringType);
        createEmptyStringArrayMethod(cls, context, "resolveAmPm", stringType, stringType);
        createEmptyStringArrayMethod(cls, context, "resolveMonths", stringType, stringType);
        createEmptyStringArrayMethod(cls, context, "resolveShortMonths", stringType, stringType);
        createEmptyStringArrayMethod(cls, context, "resolveWeekdays", stringType, stringType);
        createEmptyStringArrayMethod(cls, context, "resolveShortWeekdays", stringType, stringType);
        createEmptyStringArrayMethod(cls, context, "resolveDateFormatSymbols",
                resourceMapType, stringType, stringType);
        createConstantStringMethod(cls, context, "getTimeZoneName", null, stringType, stringType, stringType);
        createConstantStringMethod(cls, context, "resolveNumberFormat", "#", stringType, stringType);
        createConstantStringMethod(cls, context, "resolvePercentFormat", "#", stringType, stringType);
        createConstantStringMethod(cls, context, "resolveCurrencyFormat", "#", stringType, stringType);
        createConstantStringMethod(cls, context, "resolveFormatSymbols", "#",
                resourceMapType, stringType, stringType);

        replaceWithNull(cls, context, "getLikelySubtagsMap", resourceMapType);
        replaceWithNull(cls, context, "getErasMap", resourceMapType);
        replaceWithNull(cls, context, "getAmPmMap", resourceMapType);
        replaceWithNull(cls, context, "getMonthMap", resourceMapType);
        replaceWithNull(cls, context, "getShortMonthMap", resourceMapType);
        replaceWithNull(cls, context, "getWeekdayMap", resourceMapType);
        replaceWithNull(cls, context, "getShortWeekdayMap", resourceMapType);
        replaceWithNull(cls, context, "getTimeZoneLocalizationMap", resourceMapType);
        replaceWithNull(cls, context, "getLanguagesMap", resourceMapType);
        replaceWithNull(cls, context, "getCountriesMap", resourceMapType);
        replaceWithNull(cls, context, "getDefaultLocale", stringResourceType);
        replaceWithNull(cls, context, "getAvailableLocales", resourceArrayType);
        replaceWithNull(cls, context, "getMinimalDaysInFirstWeek", resourceMapType);
        replaceWithNull(cls, context, "getFirstDayOfWeek", resourceMapType);
        replaceWithNull(cls, context, "getDateFormatMap", resourceMapType);
        replaceWithNull(cls, context, "getTimeFormatMap", resourceMapType);
        replaceWithNull(cls, context, "getDateTimeFormatMap", resourceMapType);
        replaceWithNull(cls, context, "getNumberFormatMap", resourceMapType);
        replaceWithNull(cls, context, "getPercentFormatMap", resourceMapType);
        replaceWithNull(cls, context, "getCurrencyFormatMap", resourceMapType);
        replaceWithNull(cls, context, "getDecimalDataMap", resourceMapType);
        replaceWithNull(cls, context, "getCurrencyMap", resourceMapType);

        replaceWithNull(cls, context, "resolveDateFormats",
                ValueType.object("org.teavm.classlib.impl.unicode.DateFormatCollection"),
                stringType, stringType);
        replaceWithNull(cls, context, "resolveTimeFormats",
                ValueType.object("org.teavm.classlib.impl.unicode.DateFormatCollection"),
                stringType, stringType);
        replaceWithNull(cls, context, "resolveDateTimeFormats",
                ValueType.object("org.teavm.classlib.impl.unicode.DateFormatCollection"),
                stringType, stringType);
        replaceWithNull(cls, context, "resolveDateFormats",
                ValueType.object("org.teavm.classlib.impl.unicode.DateFormatCollection"),
                resourceMapType, stringType, stringType);
        replaceWithNull(cls, context, "resolveDecimalData",
                ValueType.object("org.teavm.classlib.impl.unicode.DecimalData"), stringType, stringType);
        replaceWithNull(cls, context, "resolveCurrency",
                ValueType.object("org.teavm.classlib.impl.unicode.CurrencyLocalization"),
                stringType, stringType, stringType);
    }

    private void transformXHRURLConnection(ClassHolder cls, ClassHolderTransformerContext context) {
        var stringType = ValueType.object("java.lang.String");
        var inputStreamType = ValueType.object("java.io.InputStream");
        var outputStreamType = ValueType.object("java.io.OutputStream");
        var mapType = ValueType.object("java.util.Map");
        var asyncCallbackType = ValueType.object("org.teavm.interop.AsyncCallback");

        replaceWithNoOp(cls, context, "connect", ValueType.VOID);
        replaceWithNoOp(cls, context, "disconnect", ValueType.VOID);
        replaceWithNoOp(cls, context, "performRequestIfNecessary", ValueType.VOID);
        replaceWithNull(cls, context, "performRequest", ValueType.object("java.lang.Boolean"));
        replaceWithNoOp(cls, context, "performRequest", ValueType.VOID, asyncCallbackType);
        replaceWithNoOp(cls, context, "parseHeaders", ValueType.VOID, stringType);
        replaceWithNoOp(cls, context, "lambda$performRequest$0", ValueType.VOID, asyncCallbackType);
        replaceWithNull(cls, context, "getHeaderFieldKey", stringType, ValueType.INTEGER);
        replaceWithNull(cls, context, "getHeaderField", stringType, ValueType.INTEGER);
        replaceWithNull(cls, context, "getHeaderField", stringType, stringType);
        replaceWithStaticFactory(cls, context, "getHeaderFields", mapType, "java.util.Collections", "emptyMap");
        replaceWithNull(cls, context, "getInputStream", inputStreamType);
        replaceWithConstantInt(cls, context, "getResponseCode", -1);
        replaceWithNull(cls, context, "getResponseMessage", stringType);
        replaceWithNull(cls, context, "getErrorStream", inputStreamType);
        replaceWithNull(cls, context, "getOutputStream", outputStreamType);
    }

    private void transformParseCommandLineArgumentsKt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "parseCommandLineArgumentsFromEnvironment", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonToolArguments"));
    }

    private void transformArgumentUtilsKt(ClassHolder cls, ClassHolderTransformerContext context) {
        var objectType = ValueType.object("java.lang.Object");
        var function1Type = ValueType.object("kotlin.jvm.functions.Function1");
        var function2Type = ValueType.object("kotlin.jvm.functions.Function2");
        var propertyType = ValueType.object("kotlin.reflect.KProperty1");

        replaceWithReturnedArgument(cls, context, "copyBean", objectType, 1, objectType);
        replaceWithReturnedArgument(cls, context, "copyBeanTo", objectType, 2,
                objectType, objectType, function2Type);
        replaceWithReturnedArgument(cls, context, "copyBeanTo$default", objectType, 2,
                objectType, objectType, function2Type, ValueType.INTEGER, objectType);
        replaceWithReturnedArgument(cls, context, "mergeBeans", objectType, 2, objectType, objectType);
        replaceWithReturnedArgument(cls, context, "copyInheritedFields", objectType, 2, objectType, objectType);
        replaceWithReturnedArgument(cls, context, "copyFieldsSatisfying", objectType, 2,
                objectType, objectType, function1Type);
        replaceWithReturnedArgument(cls, context, "copyProperties", objectType, 2,
                objectType, objectType, ValueType.BOOLEAN, ValueType.object("java.util.List"), function2Type);
        replaceWithReturnedArgument(cls, context, "copyProperties$default", objectType, 2,
                objectType, objectType, ValueType.BOOLEAN, ValueType.object("java.util.List"), function2Type,
                ValueType.INTEGER, objectType);
        replaceWithReturnedArgument(cls, context, "copyValueIfNeeded", objectType, 1, objectType);
        replaceWithEmptyList(cls, context, "collectProperties",
                ValueType.object("kotlin.reflect.KClass"), ValueType.BOOLEAN);
        replaceWithNoOp(cls, context, "setApiVersionToLanguageVersionIfNeeded", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonCompilerArguments"));
        replaceWithNull(cls, context, "getArgumentAnnotation",
                ValueType.object("org.jetbrains.kotlin.cli.common.arguments.Argument"), propertyType);
        replaceWithNull(cls, context, "getCliArgument", ValueType.object("java.lang.String"), propertyType);
        replaceWithReturnedArgument(cls, context, "cliArgument", ValueType.object("java.lang.String"), 2,
                propertyType, ValueType.object("java.lang.String"));
    }

    private void transformK2JVMCompilerArguments(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNull(cls, context, "getBackendThreads", ValueType.object("java.lang.String"));
    }

    private void transformBuiltInsResourceLoader(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("loadResource",
                ValueType.object("java.lang.String"), ValueType.object("java.io.InputStream")));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("org.wasmidle.kotlin.teavm.KotlinBuiltinsResources", "open",
                ValueType.object("java.io.InputStream"),
                pe.var(1, ValueType.object("java.lang.String")))
                .returnValue();
    }

    private void transformBuiltInsLoaderInstance(ClassHolder cls, ClassHolderTransformerContext context) {
        var builtInsLoaderType = ValueType.object("org.jetbrains.kotlin.builtins.BuiltInsLoader");
        var method = cls.getMethod(new MethodDescriptor("invoke", builtInsLoaderType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("org.jetbrains.kotlin.serialization.deserialization.builtins.BuiltInsLoaderImpl")
                .cast(builtInsLoaderType)
                .returnValue();
    }

    private void transformBuiltInsLoaderCompanion(ClassHolder cls, ClassHolderTransformerContext context) {
        var builtInsLoaderType = ValueType.object("org.jetbrains.kotlin.builtins.BuiltInsLoader");
        var method = cls.getMethod(new MethodDescriptor("getInstance", builtInsLoaderType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("org.jetbrains.kotlin.serialization.deserialization.builtins.BuiltInsLoaderImpl")
                .cast(builtInsLoaderType)
                .returnValue();
    }

    private void transformArgumentsKt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNull(cls, context, "buildHmppModuleStructure",
                ValueType.object("org.jetbrains.kotlin.config.HmppCliModuleStructure"),
                ValueType.object("org.jetbrains.kotlin.config.CompilerConfiguration"),
                ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonCompilerArguments"));
        replaceWithNoOp(cls, context, "reportArgumentParseProblems", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.cli.common.messages.MessageCollector"),
                ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonToolArguments"));
        replaceWithNoOp(cls, context, "reportUnsafeInternalArgumentsIfAny", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.cli.common.messages.MessageCollector"),
                ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonToolArguments"));
    }

    private void transformPathUtil(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithKotlinHomePaths(cls, context, "getKotlinPathsForCompiler");
        replaceWithKotlinHomePaths(cls, context, "getKotlinPathsForDistDirectory");
        replaceWithKotlinHomePaths(cls, context, "getKotlinPathsForIdeaPlugin");
        replaceWithFile(cls, context, "getPathUtilJar", "/kotlin-home/lib/kotlin-compiler.jar");
        replaceWithFile(cls, context, "getResourcePathForClass", "/kotlin-home/lib/kotlin-compiler.jar",
                ValueType.object("java.lang.Class"));
        replaceWithEmptyList(cls, context, "getJdkClassesRootsFromCurrentJre");
        replaceWithEmptyList(cls, context, "getJdkClassesRootsFromJre", ValueType.object("java.lang.String"));
        replaceWithEmptyList(cls, context, "getJdkClassesRoots", ValueType.object("java.io.File"));
        replaceWithEmptyList(cls, context, "getJdkClassesRootsFromJdkOrJre", ValueType.object("java.io.File"));
    }

    private void replaceWithKotlinHomePaths(ClassHolder cls, ClassHolderTransformerContext context, String name) {
        var returnType = ValueType.object("org.jetbrains.kotlin.utils.KotlinPaths");
        var method = cls.getMethod(new MethodDescriptor(name, returnType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct("org.jetbrains.kotlin.utils.KotlinPathsFromHomeDir",
                        pe.construct("java.io.File", pe.constant("/kotlin-home")))
                .cast(returnType)
                .returnValue();
    }

    private void transformCommonCompilerPerformanceManager(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "enableCollectingPerformanceStatistics", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyCompilerInitialized", ValueType.VOID,
                ValueType.INTEGER, ValueType.INTEGER, ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "notifyCompilationFinished", ValueType.VOID);
        replaceWithNoOp(cls, context, "addSourcesStats", ValueType.VOID, ValueType.INTEGER, ValueType.INTEGER);
        replaceWithNoOp(cls, context, "notifyAnalysisStarted", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyAnalysisFinished", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyGenerationStarted", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyGenerationFinished", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyIRTranslationStarted", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyIRTranslationFinished", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyIRLoweringStarted", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyIRLoweringFinished", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyIRGenerationStarted", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyIRGenerationFinished", ValueType.VOID);
        replaceWithNoOp(cls, context, "dumpPerformanceReport", ValueType.VOID,
                ValueType.object("java.io.File"));
        replaceWithNoOp(cls, context, "notifyRepeat", ValueType.VOID, ValueType.INTEGER, ValueType.INTEGER);
        replaceWithEmptyList(cls, context, "getMeasurementResults");
        replaceWithConstantString(cls, context, "renderCompilerPerformance");
    }

    private void transformPlainTextMessageRenderer(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithNoOp(cls, context, "enableColorsIfNeeded", ValueType.VOID);
        replaceWithNoOp(cls, context, "disableColorsIfNeeded", ValueType.VOID);
        replaceWithReturnedArgument(cls, context, "render", ValueType.object("java.lang.String"), 2,
                ValueType.object("org.jetbrains.kotlin.cli.common.messages.CompilerMessageSeverity"),
                ValueType.object("java.lang.String"),
                ValueType.object("org.jetbrains.kotlin.cli.common.messages.CompilerMessageSourceLocation"));
    }

    private void transformAnalyzerWithCompilerReport(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithNoOp(cls, context, "reportIncompleteHierarchies", ValueType.VOID);
        replaceWithNoOp(cls, context, "reportAlternativeSignatureErrors", ValueType.VOID);
        replaceWithNoOp(cls, context, "reportSyntaxErrors", ValueType.VOID,
                ValueType.object("java.util.Collection"));
        replaceWithConstantBoolean(cls, context, "hasErrors", false);

        var method = cls.getMethod(new MethodDescriptor("analyzeAndReport",
                ValueType.object("java.util.Collection"), ValueType.object("kotlin.jvm.functions.Function0"),
                ValueType.VOID));
        if (method != null) {
            prepareMethodBody(method);
            var reporterType = ValueType.object("org.jetbrains.kotlin.cli.common.messages.AnalyzerWithCompilerReport");
            var analysisResultType = ValueType.object("org.jetbrains.kotlin.analyzer.AnalysisResult");
            var pe = ProgramEmitter.create(method, context.getHierarchy());
            pe.var(0, reporterType).setField("analysisResult",
                    pe.var(2, ValueType.object("kotlin.jvm.functions.Function0"))
                            .invokeVirtual("invoke", ValueType.object("java.lang.Object"))
                            .cast(analysisResultType));
            pe.exit();
        }
    }

    private void transformAbstractKtDiagnosticWithParametersRenderer(ClassHolder cls,
            ClassHolderTransformerContext context) {
        var rendererType = ValueType.object("org.jetbrains.kotlin.diagnostics.AbstractKtDiagnosticWithParametersRenderer");
        var stringType = ValueType.object("java.lang.String");
        var markerType = ValueType.object("kotlin.jvm.internal.DefaultConstructorMarker");

        var constructor = cls.getMethod(new MethodDescriptor("<init>", stringType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, rendererType).invokeSpecial(Object.class, "<init>");
            pe.var(0, rendererType).setField("message", pe.var(1, stringType));
            pe.var(0, rendererType).setField("messageFormat",
                    pe.constantNull(ValueType.object("java.text.MessageFormat")));
            pe.exit();
        }

        constructor = cls.getMethod(new MethodDescriptor("<init>", stringType, markerType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, rendererType).invokeSpecial(Object.class, "<init>");
            pe.var(0, rendererType).setField("message", pe.var(1, stringType));
            pe.var(0, rendererType).setField("messageFormat",
                    pe.constantNull(ValueType.object("java.text.MessageFormat")));
            pe.exit();
        }

        replaceWithConstantString(cls, context, "render",
                ValueType.object("org.jetbrains.kotlin.diagnostics.KtDiagnostic"));
    }

    private void transformFirSyntaxErrors(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithNull(cls, context, "getSYNTAX",
                ValueType.object("org.jetbrains.kotlin.diagnostics.KtDiagnosticFactory1"));
    }

    private void transformProfilingCompilerPerformanceManager(ClassHolder cls,
            ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        var managerType = ValueType.object("org.jetbrains.kotlin.cli.common.profiling.ProfilingCompilerPerformanceManager");
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("java.lang.String"), ValueType.object("java.lang.String"),
                ValueType.object("java.io.File"), ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, managerType).invokeSpecial("org.jetbrains.kotlin.cli.common.CommonCompilerPerformanceManager",
                    "<init>", pe.constant("wasm-idle"));
            pe.var(0, managerType).setField("command", pe.var(1, ValueType.object("java.lang.String")));
            pe.var(0, managerType).setField("outputDir", pe.var(3, ValueType.object("java.io.File")));
            pe.var(0, managerType).setField("profiler",
                    pe.constantNull(ValueType.object("org.jetbrains.kotlin.cli.common.profiling.AsyncProfilerReflected")));
            pe.var(0, managerType).setField("runDate", pe.constantNull(ValueType.object("java.util.Date")));
            pe.var(0, managerType).setField("formatter",
                    pe.constantNull(ValueType.object("java.text.SimpleDateFormat")));
            pe.var(0, managerType).setField("active", pe.constant(0));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "startProfiling", ValueType.VOID);
        replaceWithNoOp(cls, context, "stopProfiling", ValueType.VOID);
        replaceWithNoOp(cls, context, "restartProfiling", ValueType.VOID);
        replaceWithNoOp(cls, context, "dumpProfile", ValueType.VOID, ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "notifyRepeat", ValueType.VOID, ValueType.INTEGER, ValueType.INTEGER);
        replaceWithNoOp(cls, context, "notifyCompilationFinished", ValueType.VOID);
    }

    private void transformK2JVMCompiler(ClassHolder cls, ClassHolderTransformerContext context) {
        var compilerType = ValueType.object("org.jetbrains.kotlin.cli.jvm.K2JVMCompiler");
        var managerType = ValueType.object("org.jetbrains.kotlin.cli.common.CommonCompilerPerformanceManager");
        var argumentsType = ValueType.object("org.jetbrains.kotlin.cli.common.arguments.K2JVMCompilerArguments");
        var commonArgumentsType = ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonCompilerArguments");
        var servicesType = ValueType.object("org.jetbrains.kotlin.config.Services");

        var method = cls.getMethod(new MethodDescriptor("createPerformanceManager",
                argumentsType, servicesType, managerType));
        if (method != null) {
            prepareMethodBody(method);
            ProgramEmitter.create(method, context.getHierarchy())
                    .var(0, compilerType)
                    .getField("defaultPerformanceManager", managerType)
                    .returnValue();
        }

        method = cls.getMethod(new MethodDescriptor("createPerformanceManager",
                commonArgumentsType, servicesType, managerType));
        if (method != null) {
            prepareMethodBody(method);
            ProgramEmitter.create(method, context.getHierarchy())
                    .var(0, compilerType)
                    .getField("defaultPerformanceManager", managerType)
                    .returnValue();
        }
    }

    private void transformGenerationState(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithEmptyList(cls, context, "loadClassBuilderInterceptors");
    }

    private void transformKotlinToJVMBytecodeCompiler(ClassHolder cls, ClassHolderTransformerContext context) {
        var codegenInputType = ValueType.object("org.jetbrains.kotlin.codegen.CodegenFactory$CodegenInput");
        var generationStateType = ValueType.object("org.jetbrains.kotlin.codegen.state.GenerationState");
        var codegenFactoryType = ValueType.object("org.jetbrains.kotlin.codegen.CodegenFactory");
        var bindingContextType = ValueType.object("org.jetbrains.kotlin.resolve.BindingContext");
        var diagnosticsCollectorType = ValueType.object(
                "org.jetbrains.kotlin.diagnostics.impl.BaseDiagnosticsCollector");
        var configurationType = ValueType.object("org.jetbrains.kotlin.config.CompilerConfiguration");
        var method = cls.getMethod(new MethodDescriptor("runCodegen",
                codegenInputType, generationStateType, codegenFactoryType, bindingContextType,
                diagnosticsCollectorType, configurationType, generationStateType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("org.wasmidle.kotlin.teavm.SimpleRunCodegen", "run",
                generationStateType,
                pe.var(1, codegenInputType),
                pe.var(2, generationStateType),
                pe.var(3, codegenFactoryType))
                .returnValue();
    }

    private void transformProjectExtensionDescriptor(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "registerExtensionPoint", ValueType.VOID,
                ValueType.object("com.intellij.openapi.project.Project"));
        replaceWithNoOp(cls, context, "registerExtension", ValueType.VOID,
                ValueType.object("com.intellij.openapi.project.Project"), ValueType.object("java.lang.Object"));
        replaceWithEmptyList(cls, context, "getInstances", ValueType.object("com.intellij.openapi.project.Project"));
    }

    private void transformEnvironmentUtil(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithStaticFactory(cls, context, "getEnvironmentMap", ValueType.object("java.util.Map"),
                "java.util.Collections", "emptyMap");
        replaceWithStaticFactory(cls, context, "getSystemEnv", ValueType.object("java.util.Map"),
                "java.util.Collections", "emptyMap");
        replaceWithNull(cls, context, "getValue", ValueType.object("java.lang.String"),
                ValueType.object("java.lang.String"));
    }

    private void transformJvmContentRootsKt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "configureJdkClasspathRoots", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.config.CompilerConfiguration"));
    }

    private void transformJvmFrontendPipelinePhase(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "dumpModel", ValueType.VOID,
                ValueType.object("java.lang.String"), ValueType.object("java.util.List"),
                ValueType.object("org.jetbrains.kotlin.config.CompilerConfiguration"),
                ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonCompilerArguments"));
    }

    private void transformModuleXmlParser(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("parseModuleScript",
                ValueType.object("java.lang.String"),
                ValueType.object("org.jetbrains.kotlin.cli.common.messages.MessageCollector"),
                ValueType.object("org.jetbrains.kotlin.cli.common.modules.ModuleChunk")));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .getField("org.jetbrains.kotlin.cli.common.modules.ModuleChunk", "EMPTY",
                        ValueType.object("org.jetbrains.kotlin.cli.common.modules.ModuleChunk"))
                .returnValue();
    }

    private void transformNewCapturedTypeKt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithReturnedArgument(cls, context, "prepareArgumentTypeRegardingCaptureTypes",
                ValueType.object("org.jetbrains.kotlin.types.UnwrappedType"), 1,
                ValueType.object("org.jetbrains.kotlin.types.UnwrappedType"));
        replaceWithReturnedArgument(cls, context, "captureFromExpression",
                ValueType.object("org.jetbrains.kotlin.types.UnwrappedType"), 1,
                ValueType.object("org.jetbrains.kotlin.types.UnwrappedType"));
        replaceWithReturnedArgument(cls, context, "captureFromArguments",
                ValueType.object("org.jetbrains.kotlin.types.SimpleType"), 1,
                ValueType.object("org.jetbrains.kotlin.types.SimpleType"),
                ValueType.object("org.jetbrains.kotlin.types.model.CaptureStatus"));
        replaceWithReturnedArgument(cls, context, "captureFromArguments",
                ValueType.object("org.jetbrains.kotlin.types.UnwrappedType"), 1,
                ValueType.object("org.jetbrains.kotlin.types.UnwrappedType"),
                ValueType.object("org.jetbrains.kotlin.types.model.CaptureStatus"));
    }

    private void transformMethodHandles(ClassHolder cls, ClassHolderTransformerContext context) {
        var lookupType = ValueType.object("java.lang.invoke.MethodHandles$Lookup");
        var method = getOrCreateStaticMethod(cls, "lookup", lookupType);
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("java.lang.invoke.MethodHandles$Lookup")
                .returnValue();

        method = getOrCreateStaticMethod(cls, "publicLookup", lookupType);
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("java.lang.invoke.MethodHandles$Lookup")
                .returnValue();
    }

    private void transformMethodHandlesLookup(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "lookupClass", ValueType.object("java.lang.Class"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constant(Object.class)
                .returnValue();

        var methodHandleType = ValueType.object("java.lang.invoke.MethodHandle");
        var methodTypeType = ValueType.object("java.lang.invoke.MethodType");
        createNullMethod(cls, context, "findStatic", methodHandleType,
                ValueType.object("java.lang.Class"), ValueType.object("java.lang.String"), methodTypeType);
        createNullMethod(cls, context, "findVirtual", methodHandleType,
                ValueType.object("java.lang.Class"), ValueType.object("java.lang.String"), methodTypeType);
        createNullMethod(cls, context, "findConstructor", methodHandleType,
                ValueType.object("java.lang.Class"), methodTypeType);
        createNullMethod(cls, context, "findStaticGetter", methodHandleType,
                ValueType.object("java.lang.Class"), ValueType.object("java.lang.String"),
                ValueType.object("java.lang.Class"));
        createNullMethod(cls, context, "unreflect", methodHandleType,
                ValueType.object("java.lang.reflect.Method"));
        createNullMethod(cls, context, "unreflectConstructor", methodHandleType,
                ValueType.object("java.lang.reflect.Constructor"));
        createNullMethod(cls, context, "unreflectGetter", methodHandleType,
                ValueType.object("java.lang.reflect.Field"));
        createNullMethod(cls, context, "unreflectSetter", methodHandleType,
                ValueType.object("java.lang.reflect.Field"));
    }

    private void transformMethodHandle(ClassHolder cls, ClassHolderTransformerContext context) {
        var objectType = ValueType.object("java.lang.Object");
        var method = getOrCreateMethod(cls, "invokeWithArguments", objectType,
                ValueType.object("java.util.List"));
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(objectType).returnValue();

        method = getOrCreateMethod(cls, "invokeWithArguments", objectType,
                ValueType.arrayOf(objectType));
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(objectType).returnValue();

        method = getOrCreateMethod(cls, "invoke", objectType);
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(objectType).returnValue();

        method = getOrCreateMethod(cls, "invoke", ValueType.object("java.lang.String"), objectType);
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.String"))
                .returnValue();

        method = getOrCreateMethod(cls, "invoke", ValueType.VOID,
                ValueType.object("java.util.ResourceBundle"));
        ProgramEmitter.create(method, context.getHierarchy()).exit();

        method = getOrCreateMethod(cls, "invoke", ValueType.VOID, objectType);
        ProgramEmitter.create(method, context.getHierarchy()).exit();

        method = getOrCreateMethod(cls, "invoke", ValueType.BOOLEAN,
                ValueType.object("java.lang.ClassLoader"), ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy()).constant(0).returnValue();

        method = getOrCreateMethod(cls, "invokeExact", objectType);
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(objectType).returnValue();

        method = getOrCreateMethod(cls, "invokeExact", objectType, objectType, ValueType.LONG);
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(objectType).returnValue();

        method = getOrCreateMethod(cls, "invokeExact", ValueType.BOOLEAN,
                objectType, ValueType.LONG, objectType, objectType);
        ProgramEmitter.create(method, context.getHierarchy()).constant(0).returnValue();

        method = getOrCreateMethod(cls, "invokeExact", ValueType.BOOLEAN,
                objectType, ValueType.LONG, ValueType.INTEGER, ValueType.INTEGER);
        ProgramEmitter.create(method, context.getHierarchy()).constant(0).returnValue();

        method = getOrCreateMethod(cls, "invokeExact", ValueType.BOOLEAN,
                objectType, ValueType.LONG, ValueType.LONG, ValueType.LONG);
        ProgramEmitter.create(method, context.getHierarchy()).constant(0).returnValue();

        method = getOrCreateMethod(cls, "invokeExact", ValueType.VOID, objectType, ValueType.LONG, objectType);
        ProgramEmitter.create(method, context.getHierarchy()).exit();

        method = getOrCreateMethod(cls, "invokeExact", ValueType.VOID, ValueType.arrayOf(objectType));
        ProgramEmitter.create(method, context.getHierarchy()).exit();

        method = getOrCreateMethod(cls, "invokeExact", ValueType.INTEGER,
                objectType, ValueType.LONG, ValueType.INTEGER);
        ProgramEmitter.create(method, context.getHierarchy()).constant(0).returnValue();

        var methodHandleType = ValueType.object("java.lang.invoke.MethodHandle");
        method = getOrCreateMethod(cls, "bindTo", methodHandleType, objectType);
        ProgramEmitter.create(method, context.getHierarchy()).var(0, methodHandleType).returnValue();

        method = getOrCreateMethod(cls, "type", ValueType.object("java.lang.invoke.MethodType"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.invoke.MethodType"))
                .returnValue();
    }

    private void transformMethodType(ClassHolder cls, ClassHolderTransformerContext context) {
        var methodType = ValueType.object("java.lang.invoke.MethodType");
        var method = getOrCreateStaticMethod(cls, "methodType", methodType, ValueType.object("java.lang.Class"));
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(methodType).returnValue();

        method = getOrCreateStaticMethod(cls, "methodType", methodType,
                ValueType.object("java.lang.Class"), ValueType.object("java.lang.Class"));
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(methodType).returnValue();

        method = getOrCreateStaticMethod(cls, "methodType", methodType,
                ValueType.object("java.lang.Class"), ValueType.object("java.lang.Class"),
                ValueType.arrayOf(ValueType.object("java.lang.Class")));
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(methodType).returnValue();

        method = getOrCreateStaticMethod(cls, "methodType", methodType,
                ValueType.object("java.lang.Class"), ValueType.object("java.util.List"));
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(methodType).returnValue();

        method = getOrCreateMethod(cls, "parameterType", ValueType.object("java.lang.Class"), ValueType.INTEGER);
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.Class"))
                .returnValue();
    }

    private void transformFiles(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "getFileAttributeView",
                ValueType.object("java.nio.file.attribute.FileAttributeView"),
                ValueType.object("java.nio.file.Path"), ValueType.object("java.lang.Class"),
                ValueType.arrayOf(ValueType.object("java.nio.file.LinkOption")));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.nio.file.attribute.FileAttributeView"))
                .returnValue();
    }

    private void transformAccessibleObject(ClassHolder cls, ClassHolderTransformerContext context) {
        var annotationArrayType = ValueType.arrayOf(ValueType.object("java.lang.annotation.Annotation"));
        var annotations = getOrCreateMethod(cls, "getAnnotations", annotationArrayType);
        ProgramEmitter.create(annotations, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.annotation.Annotation"), 0)
                .returnValue();

        var declaredAnnotations = getOrCreateMethod(cls, "getDeclaredAnnotations", annotationArrayType);
        ProgramEmitter.create(declaredAnnotations, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.annotation.Annotation"), 0)
                .returnValue();
    }

    private void transformReflectField(ClassHolder cls, ClassHolderTransformerContext context) {
        createNoOpFieldSetter(cls, context, "setBoolean", ValueType.BOOLEAN);
        createNoOpFieldSetter(cls, context, "setByte", ValueType.BYTE);
        createNoOpFieldSetter(cls, context, "setChar", ValueType.CHARACTER);
        createNoOpFieldSetter(cls, context, "setDouble", ValueType.DOUBLE);
        createNoOpFieldSetter(cls, context, "setFloat", ValueType.FLOAT);
        createNoOpFieldSetter(cls, context, "setInt", ValueType.INTEGER);
        createNoOpFieldSetter(cls, context, "setLong", ValueType.LONG);
        createNoOpFieldSetter(cls, context, "setShort", ValueType.SHORT);

        var method = getOrCreateMethod(cls, "getGenericType",
                ValueType.object("java.lang.reflect.Type"));
        ProgramEmitter.create(method, context.getHierarchy())
                .var(0, ValueType.object("java.lang.reflect.Field"))
                .invokeVirtual("getType", ValueType.object("java.lang.Class"))
                .returnValue();
    }

    private void transformReflectMethod(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "getGenericParameterTypes",
                ValueType.arrayOf(ValueType.object("java.lang.reflect.Type")));
        ProgramEmitter.create(method, context.getHierarchy())
                .var(0, ValueType.object("java.lang.reflect.Method"))
                .invokeVirtual("getParameterTypes", ValueType.arrayOf(ValueType.object("java.lang.Class")))
                .returnValue();

        method = getOrCreateMethod(cls, "getExceptionTypes",
                ValueType.arrayOf(ValueType.object("java.lang.Class")));
        ProgramEmitter.create(method, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.Class"), 0)
                .returnValue();
    }

    private void transformReflectConstructor(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "getGenericParameterTypes",
                ValueType.arrayOf(ValueType.object("java.lang.reflect.Type")));
        ProgramEmitter.create(method, context.getHierarchy())
                .var(0, ValueType.object("java.lang.reflect.Constructor"))
                .invokeVirtual("getParameterTypes", ValueType.arrayOf(ValueType.object("java.lang.Class")))
                .returnValue();
    }

    private void transformReflectType(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "getTypeName", ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy()).constant("").returnValue();
    }

    private void transformArrays(ClassHolder cls, ClassHolderTransformerContext context) {
        var arrayType = ValueType.arrayOf(ValueType.object("java.lang.Object"));
        var spliteratorType = ValueType.object("java.util.Spliterator");
        var method = getOrCreateStaticMethod(cls, "spliterator", spliteratorType, arrayType);
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(spliteratorType)
                .returnValue();

        method = getOrCreateStaticMethod(cls, "spliterator", spliteratorType, arrayType,
                ValueType.INTEGER, ValueType.INTEGER);
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(spliteratorType)
                .returnValue();
    }

    private void transformSpliterators(ClassHolder cls, ClassHolderTransformerContext context) {
        var spliteratorType = ValueType.object("java.util.Spliterator");
        var iteratorType = ValueType.object("java.util.Iterator");
        var method = getOrCreateStaticMethod(cls, "iterator", iteratorType, spliteratorType);
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke("java.util.Collections", "emptyIterator", iteratorType)
                .returnValue();

        method = getOrCreateStaticMethod(cls, "iterator", ValueType.object("java.util.PrimitiveIterator$OfInt"),
                ValueType.object("java.util.Spliterator$OfInt"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.util.PrimitiveIterator$OfInt"))
                .returnValue();
    }

    private void transformResourceBundle(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "clearCache", ValueType.VOID,
                ValueType.object("java.lang.ClassLoader"));
        ProgramEmitter.create(method, context.getHierarchy()).exit();

        method = getOrCreateStaticMethod(cls, "getBundle", ValueType.object("java.util.ResourceBundle"),
                ValueType.object("java.lang.String"), ValueType.object("java.util.Locale"),
                ValueType.object("java.lang.ClassLoader"), ValueType.object("java.util.ResourceBundle$Control"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.util.ResourceBundle"))
                .returnValue();
    }

    private void transformAbstractReflectionApiCallChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("org.jetbrains.kotlin.builtins.ReflectionTypes"),
                ValueType.object("org.jetbrains.kotlin.storage.StorageManager"),
                ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, ValueType.object("org.jetbrains.kotlin.resolve.calls.checkers.AbstractReflectionApiCallChecker"))
                    .invokeSpecial(Object.class, "<init>");
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.calls.model.ResolvedCall"),
                ValueType.object("com.intellij.psi.PsiElement"),
                ValueType.object("org.jetbrains.kotlin.resolve.calls.checkers.CallCheckerContext"));
    }

    private void transformConcurrentHashMap(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.INTEGER, ValueType.FLOAT, ValueType.INTEGER, ValueType.VOID));
        if (method == null) {
            method = new MethodHolder(new MethodDescriptor("<init>",
                    ValueType.INTEGER, ValueType.FLOAT, ValueType.INTEGER, ValueType.VOID));
            method.setLevel(AccessLevel.PUBLIC);
            cls.addMethod(method);
        }
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.var(0, ValueType.object("java.util.concurrent.ConcurrentHashMap"))
                .invokeSpecial("<init>", ValueType.VOID,
                        pe.var(1, ValueType.INTEGER), pe.var(2, ValueType.FLOAT));
        pe.exit();

        method = getOrCreateStaticMethod(cls, "newKeySet",
                ValueType.object("java.util.concurrent.ConcurrentHashMap$KeySetView"));
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("java.util.concurrent.ConcurrentHashMap$KeySetView")
                .returnValue();

        method = getOrCreateMethod(cls, "keySet",
                ValueType.object("java.util.concurrent.ConcurrentHashMap$KeySetView"));
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("java.util.concurrent.ConcurrentHashMap$KeySetView")
                .returnValue();

        method = getOrCreateMethod(cls, "keySet",
                ValueType.object("java.util.concurrent.ConcurrentHashMap$KeySetView"),
                ValueType.object("java.lang.Object"));
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("java.util.concurrent.ConcurrentHashMap$KeySetView")
                .returnValue();
    }

    private void transformContainerUtil(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("newConcurrentSet", ValueType.object("java.util.Set")));
        if (method != null) {
            ProgramEmitter.create(method, context.getHierarchy())
                    .construct("java.util.HashSet")
                    .returnValue();
        }

        var intMapType = ValueType.object("com.intellij.util.containers.ConcurrentIntObjectMap");
        method = getOrCreateStaticMethod(cls, "createConcurrentIntObjectMap", intMapType);
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("org.wasmidle.kotlin.teavm.SimpleConcurrentIntObjectMap")
                .cast(intMapType)
                .returnValue();

        var longMapType = ValueType.object("com.intellij.util.containers.ConcurrentLongObjectMap");
        method = getOrCreateStaticMethod(cls, "createConcurrentLongObjectMap", longMapType);
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("org.wasmidle.kotlin.teavm.SimpleConcurrentLongObjectMap")
                .cast(longMapType)
                .returnValue();
    }

    private void transformSystemInfoRt(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("<clinit>", ValueType.VOID));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        var owner = "com.intellij.openapi.util.SystemInfoRt";
        pe.setField(owner, "OS_NAME", pe.constant("Linux"));
        pe.setField(owner, "OS_VERSION", pe.constant(""));
        pe.setField(owner, "_OS_NAME", pe.constant("linux"));
        pe.setField(owner, "isWindows", pe.constant(0));
        pe.setField(owner, "isMac", pe.constant(0));
        pe.setField(owner, "isLinux", pe.constant(1));
        pe.setField(owner, "isFreeBSD", pe.constant(0));
        pe.setField(owner, "isSolaris", pe.constant(0));
        pe.setField(owner, "isUnix", pe.constant(1));
        pe.setField(owner, "isXWindow", pe.constant(1));
        if (cls.getField("isJBSystemMenu") != null) {
            pe.setField(owner, "isJBSystemMenu", pe.constant(0));
        }
        pe.setField(owner, "isFileSystemCaseSensitive", pe.constant(1));
        pe.exit();
    }

    private void transformStreamSupport(ClassHolder cls, ClassHolderTransformerContext context) {
        var intStreamType = ValueType.object("java.util.stream.IntStream");
        var intSpliteratorType = ValueType.object("java.util.Spliterator$OfInt");
        var method = getOrCreateStaticMethod(cls, "intStream", intStreamType,
                intSpliteratorType, ValueType.BOOLEAN);
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke("java.util.stream.IntStream", "empty", intStreamType)
                .returnValue();

        method = getOrCreateStaticMethod(cls, "intStream", intStreamType,
                ValueType.object("java.util.function.Supplier"), ValueType.INTEGER, ValueType.BOOLEAN);
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke("java.util.stream.IntStream", "empty", intStreamType)
                .returnValue();
    }

    private void transformUrlClassLoader(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "registerAsParallelCapable", ValueType.BOOLEAN);
        ProgramEmitter.create(method, context.getHierarchy()).constant(1).returnValue();

        method = getOrCreateMethod(cls, "loadClass", ValueType.object("java.lang.Class"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.Class"))
                .returnValue();

        replaceWithNull(cls, context, "getResourceAsStream",
                ValueType.object("java.io.InputStream"), ValueType.object("java.lang.String"));
        replaceWithNull(cls, context, "findResource",
                ValueType.object("java.net.URL"), ValueType.object("java.lang.String"));
        replaceWithNull(cls, context, "doFindResource",
                ValueType.object("com.intellij.util.lang.Resource"), ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "logError", ValueType.VOID,
                ValueType.object("java.lang.String"), ValueType.object("java.lang.Throwable"));
        replaceWithEmptyEnumeration(cls, context, "findResources", ValueType.object("java.lang.String"));
    }

    private void transformCodeInsightContextManagerImpl(ClassHolder cls, ClassHolderTransformerContext context) {
        var managerType = ValueType.object("com.intellij.codeInsight.multiverse.CodeInsightContextManagerImpl");
        var fileViewProviderType = ValueType.object("com.intellij.psi.FileViewProvider");
        var codeInsightContextType = ValueType.object("com.intellij.codeInsight.multiverse.CodeInsightContext");

        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("com.intellij.openapi.project.Project"),
                ValueType.object("kotlinx.coroutines.CoroutineScope"), ValueType.VOID));
        if (constructor != null) {
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, managerType).invokeSpecial(Object.class, "<init>");
            pe.exit();
        }

        replaceWithDefaultCodeInsightContext(cls, context, "getPreferredContext",
                ValueType.object("com.intellij.openapi.vfs.VirtualFile"));
        replaceWithDefaultCodeInsightContext(cls, context, "getCodeInsightContext", fileViewProviderType);
        replaceWithDefaultCodeInsightContext(cls, context, "getOrSetContext",
                fileViewProviderType, codeInsightContextType);
        replaceWithDefaultCodeInsightContext(cls, context, "getCodeInsightContextRaw", fileViewProviderType);
        replaceWithConstantBoolean(cls, context, "isSharedSourceSupportEnabled", false);
        replaceWithNoOp(cls, context, "setCodeInsightContext", ValueType.VOID,
                fileViewProviderType, codeInsightContextType);
        replaceWithNoOp(cls, context, "dispose", ValueType.VOID);
    }

    private void transformApplicationInfoImpl(ClassHolder cls, ClassHolderTransformerContext context) {
        var appInfoType = ValueType.object("com.intellij.openapi.application.impl.ApplicationInfoImpl");
        var constructors = new MethodDescriptor[] {
                new MethodDescriptor("<init>", ValueType.VOID),
                new MethodDescriptor("<init>", ValueType.object("com.intellij.util.xml.dom.XmlElement"),
                        ValueType.VOID),
                new MethodDescriptor("<init>", ValueType.object("com.intellij.util.XmlElement"),
                        ValueType.VOID)
        };
        for (var descriptor : constructors) {
            var constructor = cls.getMethod(descriptor);
            if (constructor == null) {
                continue;
            }
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, appInfoType)
                    .invokeSpecial("com.intellij.openapi.application.ex.ApplicationInfoEx", "<init>");
            var essentialPlugins = pe.construct("java.util.ArrayList").cast(ValueType.object("java.util.List"));
            if (cls.getField("essentialPluginIds") != null) {
                pe.var(0, appInfoType).setField("essentialPluginIds", essentialPlugins);
            }
            if (cls.getField("essentialPluginsIds") != null) {
                pe.var(0, appInfoType).setField("essentialPluginsIds", essentialPlugins);
            }
            pe.exit();
        }
    }

    private void transformDebugAttachDetectorArgs(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithConstantBoolean(cls, context, "isDebugEnabled", false);
        replaceWithConstantBoolean(cls, context, "isAttached", false);
    }

    private void transformCancellation(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithNull(cls, context, "currentJob", ValueType.object("kotlinx.coroutines.Job"));
        replaceWithConstantBoolean(cls, context, "isCancelled", false);
        replaceWithNoOp(cls, context, "checkCancelled", ValueType.VOID);
        replaceWithEmptyAccessToken(cls, context, "withJob", ValueType.object("kotlinx.coroutines.Job"));
        replaceWithConstantBoolean(cls, context, "isInNonCancelableSection", false);
        replaceWithConstantBoolean(cls, context, "isInNonCancelableSectionInternal", false);
    }

    private void transformCoreProgressManager(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithConstantBoolean(cls, context, "runCheckCanceledHooks", false,
                ValueType.object("com.intellij.openapi.progress.ProgressIndicator"));
        replaceWithNoOp(cls, context, "doCheckCanceled", ValueType.VOID);
    }

    private void transformProgressIndicatorProvider(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "checkCanceled", ValueType.VOID);
        replaceWithNull(cls, context, "getGlobalProgressIndicator",
                ValueType.object("com.intellij.openapi.progress.ProgressIndicator"));
    }

    private void transformProgressManager(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "checkCanceled", ValueType.VOID);
        replaceWithNoOp(cls, context, "progress", ValueType.VOID, ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "progress2", ValueType.VOID, ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "progress", ValueType.VOID,
                ValueType.object("java.lang.String"), ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "canceled", ValueType.VOID,
                ValueType.object("com.intellij.openapi.progress.ProgressIndicator"));
        replaceWithNoOp(cls, context, "assertNotCircular", ValueType.VOID,
                ValueType.object("com.intellij.openapi.progress.ProgressIndicator"));
    }

    private void transformEdt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNull(cls, context, "getEventDispatchThreadOrNull",
                ValueType.object("java.lang.Thread"));
        replaceWithConstantBoolean(cls, context, "isCurrentThreadEdt", true);
    }

    private void transformThreadDumper(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithConstantString(cls, context, "dumpThreadsToString");
    }

    private void transformServiceLoaderLite(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithEmptyList(cls, context, "loadImplementations",
                ValueType.object("java.lang.Class"), ValueType.object("java.net.URLClassLoader"));
        replaceWithEmptyList(cls, context, "loadImplementations",
                ValueType.object("java.lang.Class"), ValueType.object("java.util.List"),
                ValueType.object("java.lang.ClassLoader"));
        replaceWithEmptySet(cls, context, "findImplementations", ValueType.object("java.util.List"));
        replaceWithEmptyList(cls, context, "loadImplementations", ValueType.object("java.net.URLClassLoader"));
        replaceWithEmptyList(cls, context, "loadImplementations",
                ValueType.object("java.util.List"), ValueType.object("java.lang.ClassLoader"));
        replaceWithEmptySet(cls, context, "findImplementations",
                ValueType.object("java.lang.Class"), ValueType.object("java.util.List"));
        replaceWithEmptySet(cls, context, "findImplementations",
                ValueType.object("java.lang.Class"), ValueType.object("java.io.File"));
        replaceWithEmptySet(cls, context, "findImplementationsInDirectory",
                ValueType.object("java.lang.String"), ValueType.object("java.io.File"));
        replaceWithEmptySet(cls, context, "findImplementationsInJar",
                ValueType.object("java.lang.String"), ValueType.object("java.io.File"));
        replaceWithEmptySet(cls, context, "parseLines",
                ValueType.object("java.io.File"), ValueType.object("kotlin.sequences.Sequence"));
        replaceWithConstantString(cls, context, "parseLine",
                ValueType.object("java.io.File"), ValueType.object("java.lang.String"));
        replaceWithConstantString(cls, context, "getClassIdentifier", ValueType.object("java.lang.Class"));
    }

    private void transformIrOverrideChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var memberType = ValueType.object("org.jetbrains.kotlin.ir.overrides.MemberWithOriginal");
        var compatibilityType = ValueType.object("org.jetbrains.kotlin.resolve.OverridingUtil$OverrideCompatibilityInfo");
        var resultType = ValueType.object("org.jetbrains.kotlin.resolve.OverridingUtil$OverrideCompatibilityInfo$Result");
        var bothWays = cls.getMethod(new MethodDescriptor("getBothWaysOverridability",
                memberType, memberType, resultType));
        if (bothWays != null) {
            prepareMethodBody(bothWays);
            ProgramEmitter.create(bothWays, context.getHierarchy())
                    .getField("org.jetbrains.kotlin.resolve.OverridingUtil$OverrideCompatibilityInfo$Result",
                            "OVERRIDABLE", resultType)
                    .returnValue();
        }
        replaceWithOverrideCompatibilitySuccess(cls, context, "isOverridableBy",
                memberType, memberType, ValueType.BOOLEAN);
        replaceWithOverrideCompatibilitySuccess(cls, context, "isOverridableByWithoutExternalConditions",
                ValueType.object("org.jetbrains.kotlin.ir.declarations.IrOverridableMember"),
                ValueType.object("org.jetbrains.kotlin.ir.declarations.IrOverridableMember"), ValueType.BOOLEAN);
        replaceWithReturnedArgument(cls, context, "runExternalOverridabilityConditions", compatibilityType, 3,
                memberType, memberType, compatibilityType);
    }

    private void transformCommonBackendErrors(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithNull(cls, context, "getNO_ACTUAL_FOR_EXPECT",
                ValueType.object("org.jetbrains.kotlin.diagnostics.KtDiagnosticFactory2"));
        replaceWithNull(cls, context, "getMANY_INTERFACES_MEMBER_NOT_IMPLEMENTED",
                ValueType.object("org.jetbrains.kotlin.diagnostics.KtDiagnosticFactory2"));
        replaceWithNull(cls, context, "getMANY_IMPL_MEMBER_NOT_IMPLEMENTED",
                ValueType.object("org.jetbrains.kotlin.diagnostics.KtDiagnosticFactory2"));
        replaceWithNull(cls, context, "getINCOMPATIBLE_MATCHING",
                ValueType.object("org.jetbrains.kotlin.diagnostics.KtDiagnosticFactory3"));
        replaceWithNull(cls, context, "getACTUAL_ANNOTATIONS_NOT_MATCH_EXPECT",
                ValueType.object("org.jetbrains.kotlin.diagnostics.KtDiagnosticFactory3"));
        replaceWithNull(cls, context, "getEVALUATION_ERROR",
                ValueType.object("org.jetbrains.kotlin.diagnostics.KtDiagnosticFactory1"));
    }

    private void transformIrExpectActualAnnotationMatchingChecker(ClassHolder cls,
            ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "check", ValueType.VOID);
    }

    private void transformIrActualizerUtilsKt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "reportMissingActual", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.KtDiagnosticReporterWithImplicitIrBasedContext"),
                ValueType.object("org.jetbrains.kotlin.ir.symbols.IrSymbol"));
        replaceWithNoOp(cls, context, "reportMissingActual", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.KtDiagnosticReporterWithImplicitIrBasedContext"),
                ValueType.object("org.jetbrains.kotlin.ir.declarations.IrDeclaration"));
        replaceWithNoOp(cls, context, "reportIncompatibleExpectActual", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.KtDiagnosticReporterWithImplicitIrBasedContext"),
                ValueType.object("org.jetbrains.kotlin.ir.symbols.IrSymbol"),
                ValueType.object("org.jetbrains.kotlin.ir.symbols.IrSymbol"),
                ValueType.object("org.jetbrains.kotlin.resolve.multiplatform.ExpectActualCompatibility$Incompatible"));
        replaceWithNoOp(cls, context, "reportActualAnnotationsNotMatchExpect", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.KtDiagnosticReporterWithImplicitIrBasedContext"),
                ValueType.object("org.jetbrains.kotlin.ir.symbols.IrSymbol"),
                ValueType.object("org.jetbrains.kotlin.ir.symbols.IrSymbol"),
                ValueType.object("org.jetbrains.kotlin.resolve.multiplatform.ExpectActualAnnotationsIncompatibilityType"),
                ValueType.object("org.jetbrains.kotlin.ir.symbols.IrSymbol"));
    }

    private void transformTransactionGuardImpl(ClassHolder cls, ClassHolderTransformerContext context) {
        var guardType = ValueType.object("com.intellij.openapi.application.TransactionGuardImpl");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", ValueType.VOID));
        if (constructor != null) {
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, guardType)
                    .invokeSpecial("com.intellij.openapi.application.TransactionGuard", "<init>");
            pe.exit();
        }
        replaceWithConstantBoolean(cls, context, "isWriteSafeModality", true,
                ValueType.object("com.intellij.openapi.application.ModalityState"));
        replaceWithNoOp(cls, context, "assertWriteActionAllowed", ValueType.VOID);
        replaceWithNoOp(cls, context, "enteredModality", ValueType.VOID,
                ValueType.object("com.intellij.openapi.application.ModalityState"));
        replaceWithConstantString(cls, context, "toString");
    }

    private void transformThreadingAssertions(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "assertEventDispatchThread", ValueType.VOID);
        replaceWithNoOp(cls, context, "assertBackgroundThread", ValueType.VOID);
        replaceWithNoOp(cls, context, "softAssertReadAccess", ValueType.VOID);
        replaceWithNoOp(cls, context, "assertWriteAccess", ValueType.VOID);
        replaceWithNoOp(cls, context, "trySoftAssertReadAccessWhenLocksAreForbidden", ValueType.VOID);
        replaceWithNoOp(cls, context, "trySoftAssertWriteAccessWhenLocksAreForbidden", ValueType.VOID);
    }

    private void transformMockProject(ClassHolder cls, ClassHolderTransformerContext context) {
        var projectType = ValueType.object("com.intellij.mock.MockProject");
        var picoType = ValueType.object("org.picocontainer.PicoContainer");
        var disposableType = ValueType.object("com.intellij.openapi.Disposable");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", picoType, disposableType, ValueType.VOID));
        if (constructor != null) {
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, projectType)
                    .invokeSpecial("com.intellij.mock.MockComponentManager", "<init>",
                            pe.var(1, picoType), pe.var(2, disposableType));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "dispose", ValueType.VOID);
        replaceWithNull(cls, context, "getCoroutineScope",
                ValueType.object("kotlinx.coroutines.CoroutineScope"));
    }

    private void transformReflectionUtil(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithNull(cls, context, "proxy", ValueType.object("java.lang.Object"),
                ValueType.object("java.lang.Class"), ValueType.object("java.lang.reflect.InvocationHandler"));
        var constructorType = ValueType.object("java.lang.reflect.Constructor");
        var objectArrayType = ValueType.arrayOf(ValueType.object("java.lang.Object"));
        var method = cls.getMethod(new MethodDescriptor("createInstance",
                constructorType, objectArrayType, ValueType.object("java.lang.Object")));
        if (method != null) {
            prepareMethodBody(method);
            var pe = ProgramEmitter.create(method, context.getHierarchy());
            pe.invoke("org.wasmidle.kotlin.teavm.SimpleReflection", "createInstance",
                    ValueType.object("java.lang.Object"), pe.var(1, constructorType), pe.var(2, objectArrayType))
                    .returnValue();
        }
    }

    private void transformCoreCommandProcessor(ClassHolder cls, ClassHolderTransformerContext context) {
        var processorType = ValueType.object("com.intellij.openapi.command.impl.CoreCommandProcessor");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, processorType).invokeSpecial("com.intellij.openapi.command.CommandProcessorEx", "<init>");
            pe.var(0, processorType).setField("myInterruptedCommands",
                    pe.construct("com.intellij.util.containers.Stack"));
            pe.var(0, processorType).setField("myListeners", pe.construct("java.util.ArrayList"));
            pe.var(0, processorType).setField("eventPublisher",
                    pe.constantNull(ValueType.object("com.intellij.openapi.command.CommandListener")));
            pe.exit();
        }

        replaceWithNoOp(cls, context, "fireCommandStarted", ValueType.VOID);
        replaceWithNoOp(cls, context, "fireCommandFinished", ValueType.VOID);
    }

    private void transformExceptionUtil(ClassHolder cls, ClassHolderTransformerContext context) {
        var streamType = ValueType.object("java.util.stream.Stream");
        var method = getOrCreateStaticMethod(cls, "causeAndSuppressed", streamType,
                ValueType.object("java.lang.Throwable"), ValueType.object("java.lang.Class"));
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke("java.util.stream.Stream", "empty", streamType)
                .returnValue();
    }

    private void transformClassFileDecompilers(ClassHolder cls, ClassHolderTransformerContext context) {
        var type = ValueType.object("com.intellij.psi.compiled.ClassFileDecompilers");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, type).invokeSpecial("java.lang.Object", "<init>");
            pe.var(0, type).setField("EP_NAME",
                    pe.constantNull(ValueType.object("com.intellij.openapi.extensions.ExtensionPointName")));
            pe.exit();
        }

        var method = getOrCreateStaticMethod(cls, "getInstance", type);
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("com.intellij.psi.compiled.ClassFileDecompilers")
                .returnValue();

        replaceWithNull(cls, context, "find", ValueType.object("com.intellij.psi.compiled.ClassFileDecompilers$Decompiler"),
                ValueType.object("com.intellij.openapi.vfs.VirtualFile"), ValueType.object("java.lang.Class"));
    }

    private void transformLanguageSubstitutors(ClassHolder cls, ClassHolderTransformerContext context) {
        makeConstructorsPublic(cls);
        var type = ValueType.object("com.intellij.psi.LanguageSubstitutors");
        var languageType = ValueType.object("com.intellij.lang.Language");
        var virtualFileType = ValueType.object("com.intellij.openapi.vfs.VirtualFile");
        var projectType = ValueType.object("com.intellij.openapi.project.Project");

        var method = getOrCreateStaticMethod(cls, "getInstance", type);
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("com.intellij.psi.LanguageSubstitutors")
                .returnValue();

        replaceWithReturnedArgument(cls, context, "substituteLanguage", languageType, 1,
                languageType, virtualFileType, projectType);
        replaceWithNoOp(cls, context, "cancelReparsing", ValueType.VOID, virtualFileType);
    }

    private void transformKotlinElementTypeProviderCompanion(ClassHolder cls, ClassHolderTransformerContext context) {
        var returnType = ValueType.object("org.jetbrains.kotlin.KotlinElementTypeProvider");
        var method = getOrCreateMethod(cls, "getInstance", returnType);
        ProgramEmitter.create(method, context.getHierarchy())
                .getField("org.jetbrains.kotlin.psi.impl.KotlinElementTypeProviderImpl", "INSTANCE", returnType)
                .returnValue();
    }

    private void transformObjectTree(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "register", ValueType.VOID,
                ValueType.object("com.intellij.openapi.Disposable"),
                ValueType.object("com.intellij.openapi.Disposable"));
        replaceWithNoOp(cls, context, "executeAll", ValueType.VOID,
                ValueType.object("com.intellij.openapi.Disposable"), ValueType.BOOLEAN);
        replaceWithNoOp(cls, context, "handleExceptions", ValueType.VOID,
                ValueType.object("java.util.List"));
    }

    private void transformRegistry(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithConstantBoolean(cls, context, "is", false, ValueType.object("java.lang.String"));
        replaceWithReturnedArgument(cls, context, "is", ValueType.BOOLEAN, 2,
                ValueType.object("java.lang.String"), ValueType.BOOLEAN);
        replaceWithConstantInt(cls, context, "intValue", 0, ValueType.object("java.lang.String"));
        replaceWithStaticFactory(cls, context, "loadFromBundledConfig", ValueType.object("java.util.Map"),
                "java.util.Collections", "emptyMap");
        replaceWithNull(cls, context, "getBundleValueOrNull", ValueType.object("java.lang.String"),
                ValueType.object("java.lang.String"));
        createConstantStringInstanceMethod(cls, context, "getBundleValue", "0",
                ValueType.object("java.lang.String"));
        replaceWithConstantBoolean(cls, context, "isLoaded", true);
    }

    private void transformRegistryValue(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithConstantString(cls, context, "asString");
        replaceWithConstantBoolean(cls, context, "asBoolean", false);
        replaceWithConstantInt(cls, context, "asInteger", 0);
        replaceWithConstantBoolean(cls, context, "isRestartRequired", false);
        replaceWithConstantBoolean(cls, context, "isChangedFromDefault", false);
        replaceWithConstantBoolean(cls, context, "isChangedFromDefault", false,
                ValueType.object("java.lang.String"),
                ValueType.object("com.intellij.openapi.util.registry.Registry"));
        replaceWithReturnedArgument(cls, context, "get", ValueType.object("java.lang.String"), 2,
                ValueType.object("java.lang.String"), ValueType.object("java.lang.String"), ValueType.BOOLEAN);
        replaceWithReturnedArgument(cls, context, "_get", ValueType.object("java.lang.String"), 2,
                ValueType.object("java.lang.String"), ValueType.object("java.lang.String"), ValueType.BOOLEAN);
        replaceWithNoOp(cls, context, "setValue", ValueType.VOID, ValueType.BOOLEAN);
        replaceWithNoOp(cls, context, "setValue", ValueType.VOID, ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "setValue", ValueType.VOID,
                ValueType.BOOLEAN, ValueType.object("com.intellij.openapi.Disposable"));
        replaceWithConstantString(cls, context, "toString");
        replaceWithNoOp(cls, context, "resetCache", ValueType.VOID);
    }

    private void transformDisposer(ClassHolder cls, ClassHolderTransformerContext context) {
        var disposableType = ValueType.object("com.intellij.openapi.Disposable");
        replaceWithNoOp(cls, context, "register", ValueType.VOID, disposableType, disposableType);
        replaceWithNoOp(cls, context, "dispose", ValueType.VOID, disposableType);
        replaceWithNoOp(cls, context, "dispose", ValueType.VOID, disposableType, ValueType.BOOLEAN);
        replaceWithNull(cls, context, "getDisposalTrace", ValueType.object("java.lang.Throwable"), disposableType);
    }

    private void transformPsiModificationTrackerImpl(ClassHolder cls, ClassHolderTransformerContext context) {
        var trackerImplType = ValueType.object("com.intellij.psi.impl.PsiModificationTrackerImpl");
        var simpleTrackerType = ValueType.object("com.intellij.openapi.util.SimpleModificationTracker");
        var mapType = ValueType.object("java.util.Map");
        var modificationTrackerType = ValueType.object("com.intellij.openapi.util.ModificationTracker");

        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("com.intellij.openapi.project.Project"), ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, trackerImplType).invokeSpecial("java.lang.Object", "<init>");
            pe.var(0, trackerImplType).setField("myModificationCount",
                    pe.construct("com.intellij.openapi.util.SimpleModificationTracker"));
            pe.var(0, trackerImplType).setField("myAllLanguagesTracker",
                    pe.construct("com.intellij.openapi.util.SimpleModificationTracker"));
            pe.var(0, trackerImplType).setField("myLanguageTrackers",
                    pe.construct("java.util.HashMap").cast(mapType));
            pe.var(0, trackerImplType).setField("myPublisher",
                    pe.constantNull(ValueType.object("com.intellij.psi.util.PsiModificationTracker$Listener")));
            pe.exit();
        }

        replaceWithNoOp(cls, context, "fireEvent", ValueType.VOID);
        replaceWithNoOp(cls, context, "treeChanged", ValueType.VOID,
                ValueType.object("com.intellij.psi.impl.PsiTreeChangeEventImpl"));
        replaceWithNoOp(cls, context, "incLanguageModificationCount", ValueType.VOID,
                ValueType.object("com.intellij.lang.Language"));

        var method = cls.getMethod(new MethodDescriptor("getJavaStructureModificationTracker",
                appendReturnType(modificationTrackerType, new ValueType[0])));
        if (method != null) {
            prepareMethodBody(method);
            ProgramEmitter.create(method, context.getHierarchy())
                    .var(0, trackerImplType)
                    .getField("myModificationCount", simpleTrackerType)
                    .cast(modificationTrackerType)
                    .returnValue();
        }

        method = cls.getMethod(new MethodDescriptor("forLanguage",
                appendReturnType(modificationTrackerType,
                        new ValueType[] { ValueType.object("com.intellij.lang.Language") })));
        if (method != null) {
            prepareMethodBody(method);
            ProgramEmitter.create(method, context.getHierarchy())
                    .var(0, trackerImplType)
                    .getField("myAllLanguagesTracker", simpleTrackerType)
                    .cast(modificationTrackerType)
                    .returnValue();
        }

        method = cls.getMethod(new MethodDescriptor("forLanguages",
                appendReturnType(modificationTrackerType,
                        new ValueType[] { ValueType.object("java.util.function.Predicate") })));
        if (method != null) {
            prepareMethodBody(method);
            ProgramEmitter.create(method, context.getHierarchy())
                    .var(0, trackerImplType)
                    .getField("myAllLanguagesTracker", simpleTrackerType)
                    .cast(modificationTrackerType)
                    .returnValue();
        }
    }

    private void transformVirtualFileManagerImpl(ClassHolder cls, ClassHolderTransformerContext context) {
        var managerType = ValueType.object("com.intellij.openapi.vfs.impl.VirtualFileManagerImpl");
        var listType = ValueType.object("java.util.List");
        var collectionType = ValueType.object("java.util.Collection");
        var messageBusType = ValueType.object("com.intellij.util.messages.MessageBus");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", listType, messageBusType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, managerType).invokeSpecial("com.intellij.openapi.vfs.VirtualFileManager", "<init>");
            pe.var(0, managerType).setField("myCollector",
                    pe.constantNull(ValueType.object("com.intellij.openapi.util.KeyedExtensionCollector")));
            pe.var(0, managerType).setField("myVirtualFileListenerMulticaster",
                    pe.constantNull(ValueType.object("com.intellij.util.EventDispatcher")));
            if (cls.getField("virtualFileManagerListeners") != null) {
                pe.var(0, managerType).setField("virtualFileManagerListeners", pe.construct("java.util.ArrayList"));
            }
            if (cls.getField("myVirtualFileManagerListeners") != null) {
                pe.var(0, managerType).setField("myVirtualFileManagerListeners", pe.construct("java.util.ArrayList"));
            }
            if (cls.getField("asyncFileListeners") != null) {
                pe.var(0, managerType).setField("asyncFileListeners", pe.construct("java.util.ArrayList"));
            }
            if (cls.getField("myAsyncFileListeners") != null) {
                pe.var(0, managerType).setField("myAsyncFileListeners", pe.construct("java.util.ArrayList"));
            }
            pe.var(0, managerType).setField("myPreCreatedFileSystems",
                    pe.construct("java.util.ArrayList", pe.var(1, collectionType)));
            pe.exit();
        }

        constructor = cls.getMethod(new MethodDescriptor("<init>", listType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, managerType).invokeSpecial("com.intellij.openapi.vfs.impl.VirtualFileManagerImpl", "<init>",
                    pe.var(1, listType), pe.constantNull(messageBusType));
            pe.exit();
        }

        var method = getOrCreateMethod(cls, "getFileSystemsForProtocol", listType,
                ValueType.object("java.lang.String"));
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("org.wasmidle.kotlin.teavm.BrowserVirtualFileSystems", "forProtocol", listType,
                pe.var(0, managerType).getField("myPreCreatedFileSystems", listType),
                pe.var(1, ValueType.object("java.lang.String")))
                .returnValue();

        replaceWithNoOp(cls, context, "addVirtualFileListener", ValueType.VOID,
                ValueType.object("com.intellij.openapi.vfs.VirtualFileListener"));
        replaceWithNoOp(cls, context, "notifyPropertyChanged", ValueType.VOID,
                ValueType.object("com.intellij.openapi.vfs.VirtualFile"), ValueType.object("java.lang.String"),
                ValueType.object("java.lang.Object"), ValueType.object("java.lang.Object"));
        replaceWithNoOp(cls, context, "dispose", ValueType.VOID);
    }

    private void transformDeprecatedVirtualFileSystem(ClassHolder cls, ClassHolderTransformerContext context) {
        var virtualFileType = ValueType.object("com.intellij.openapi.vfs.VirtualFile");
        var listenerType = ValueType.object("com.intellij.openapi.vfs.VirtualFileListener");
        var objectType = ValueType.object("java.lang.Object");
        var stringType = ValueType.object("java.lang.String");

        replaceWithNoOp(cls, context, "startEventPropagation", ValueType.VOID);
        replaceWithNoOp(cls, context, "addVirtualFileListener", ValueType.VOID, listenerType);
        replaceWithNoOp(cls, context, "removeVirtualFileListener", ValueType.VOID, listenerType);
        replaceWithNoOp(cls, context, "firePropertyChanged", ValueType.VOID,
                objectType, virtualFileType, stringType, objectType, objectType);
        replaceWithNoOp(cls, context, "fireContentsChanged", ValueType.VOID,
                objectType, virtualFileType, ValueType.LONG);
        replaceWithNoOp(cls, context, "fireFileCreated", ValueType.VOID, objectType, virtualFileType);
        replaceWithNoOp(cls, context, "fireFileDeleted", ValueType.VOID,
                objectType, virtualFileType, stringType, virtualFileType);
        replaceWithNoOp(cls, context, "fireFileMoved", ValueType.VOID,
                objectType, virtualFileType, virtualFileType);
        replaceWithNoOp(cls, context, "fireFileCopied", ValueType.VOID,
                objectType, virtualFileType, virtualFileType);
        replaceWithNoOp(cls, context, "fireBeforePropertyChange", ValueType.VOID,
                objectType, virtualFileType, stringType, objectType, objectType);
        replaceWithNoOp(cls, context, "fireBeforeContentsChange", ValueType.VOID, objectType, virtualFileType);
        replaceWithNoOp(cls, context, "fireBeforeFileDeletion", ValueType.VOID, objectType, virtualFileType);
        replaceWithNoOp(cls, context, "fireBeforeFileMovement", ValueType.VOID,
                objectType, virtualFileType, virtualFileType);
    }

    private void transformDummyIconManager(ClassHolder cls, ClassHolderTransformerContext context) {
        var iconType = ValueType.object("javax.swing.Icon");
        replaceWithNull(cls, context, "getPlatformIcon", iconType,
                ValueType.object("com.intellij.ui.PlatformIcons"));
        replaceWithNull(cls, context, "createLayeredIcon", ValueType.object("com.intellij.ui.icons.RowIcon"),
                ValueType.object("com.intellij.openapi.util.Iconable"), iconType, ValueType.INTEGER);
        replaceWithNoOp(cls, context, "registerIconLayer", ValueType.VOID, ValueType.INTEGER, iconType);
        replaceWithReturnedArgument(cls, context, "tooltipOnlyIfComposite", iconType, 1, iconType);
        replaceWithReturnedArgument(cls, context, "createDeferredIcon", iconType, 1,
                iconType, ValueType.object("java.lang.Object"), ValueType.object("kotlin.jvm.functions.Function1"));
        replaceWithNull(cls, context, "createRowIcon", ValueType.object("com.intellij.ui.icons.RowIcon"),
                ValueType.arrayOf(iconType));
    }

    private void transformElementBase(ClassHolder cls, ClassHolderTransformerContext context) {
        var iconType = ValueType.object("javax.swing.Icon");
        replaceWithNull(cls, context, "getIcon", iconType, ValueType.INTEGER);
        replaceWithNull(cls, context, "computeIcon", iconType, ValueType.INTEGER);
        replaceWithNull(cls, context, "computeIconNow", iconType,
                ValueType.object("com.intellij.psi.PsiElement"), ValueType.INTEGER);
        replaceWithNull(cls, context, "doComputeIconNow", iconType,
                ValueType.object("com.intellij.psi.PsiElement"), ValueType.INTEGER);
        replaceWithNull(cls, context, "computeBaseIcon", iconType, ValueType.INTEGER);
        replaceWithNull(cls, context, "getBaseIcon", iconType);
        replaceWithReturnedArgument(cls, context, "getAdjustedBaseIcon", iconType, 1, iconType, ValueType.INTEGER);
        replaceWithNull(cls, context, "buildRowIcon", ValueType.object("com.intellij.ui.icons.RowIcon"),
                iconType, iconType);
        replaceWithReturnedArgument(cls, context, "iconWithVisibilityIfNeeded", iconType, 1,
                ValueType.INTEGER, iconType, iconType);
        replaceWithNull(cls, context, "getElementIcon", iconType, ValueType.INTEGER);
        replaceWithNull(cls, context, "lambda$computeIconNow$3", iconType,
                ValueType.object("com.intellij.psi.PsiElement"), ValueType.INTEGER);
        replaceWithNull(cls, context, "lambda$computeIcon$2", iconType, ValueType.INTEGER);
        replaceWithNull(cls, context, "lambda$static$1", iconType);
        replaceWithNull(cls, context, "lambda$static$0", iconType,
                ValueType.object("com.intellij.psi.impl.ElementBase$ElementIconRequest"));
    }

    private void transformUnsafe(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithNull(cls, context, "find", ValueType.object("java.lang.invoke.MethodHandle"),
                ValueType.object("java.lang.String"), ValueType.object("java.lang.Class"),
                ValueType.arrayOf(ValueType.object("java.lang.Class")));
        replaceWithConstantBoolean(cls, context, "compareAndSwapInt", false,
                ValueType.object("java.lang.Object"), ValueType.LONG, ValueType.INTEGER, ValueType.INTEGER);
        replaceWithConstantBoolean(cls, context, "compareAndSwapLong", false,
                ValueType.object("java.lang.Object"), ValueType.LONG, ValueType.LONG, ValueType.LONG);
        replaceWithConstantBoolean(cls, context, "compareAndSwapObject", false,
                ValueType.object("java.lang.Object"), ValueType.LONG,
                ValueType.object("java.lang.Object"), ValueType.object("java.lang.Object"));
        replaceWithConstantInt(cls, context, "getAndAddInt", 0,
                ValueType.object("java.lang.Object"), ValueType.LONG, ValueType.INTEGER);
        replaceWithNull(cls, context, "getObjectVolatile", ValueType.object("java.lang.Object"),
                ValueType.object("java.lang.Object"), ValueType.LONG);
        replaceWithNoOp(cls, context, "putObjectVolatile", ValueType.VOID,
                ValueType.object("java.lang.Object"), ValueType.LONG, ValueType.object("java.lang.Object"));
        replaceWithConstantLong(cls, context, "objectFieldOffset", 0,
                ValueType.object("java.lang.reflect.Field"));
        replaceWithConstantInt(cls, context, "arrayIndexScale", 1, ValueType.object("java.lang.Class"));
        replaceWithConstantInt(cls, context, "arrayBaseOffset", 0, ValueType.object("java.lang.Class"));
        replaceWithNoOp(cls, context, "copyMemory", ValueType.VOID,
                ValueType.object("java.lang.Object"), ValueType.LONG, ValueType.object("java.lang.Object"),
                ValueType.LONG, ValueType.LONG);
    }

    private void transformMessageBusImplKt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "pumpWaiting", ValueType.VOID,
                ValueType.object("com.intellij.util.messages.impl.MessageQueue"));
        replaceWithNull(cls, context, "deliverMessage", ValueType.object("java.lang.Throwable"),
                ValueType.object("com.intellij.util.messages.impl.Message"),
                ValueType.object("com.intellij.util.messages.impl.MessageQueue"),
                ValueType.object("java.lang.Throwable"));
        replaceWithNull(cls, context, "executeOrAddToQueue", ValueType.object("java.lang.Throwable"),
                ValueType.object("com.intellij.util.messages.Topic"),
                ValueType.object("java.lang.reflect.Method"), ValueType.arrayOf(ValueType.object("java.lang.Object")),
                ValueType.arrayOf(ValueType.object("java.lang.Object")),
                ValueType.object("com.intellij.util.messages.impl.MessageQueue"),
                ValueType.object("java.lang.Throwable"),
                ValueType.object("com.intellij.util.messages.impl.MessageBusImpl"));
        replaceWithEmptyList(cls, context, "deliverImmediately",
                ValueType.object("com.intellij.util.messages.impl.MessageBusConnectionImpl"),
                ValueType.object("java.util.Deque"));
        replaceWithNull(cls, context, "invokeListener", ValueType.object("java.lang.Throwable"),
                ValueType.object("java.lang.invoke.MethodHandle"), ValueType.object("java.lang.String"),
                ValueType.arrayOf(ValueType.object("java.lang.Object")),
                ValueType.object("com.intellij.util.messages.Topic"),
                ValueType.object("java.lang.Object"), ValueType.object("java.util.Set"),
                ValueType.object("java.lang.Throwable"));
        replaceWithNoOp(cls, context, "invokeMethod", ValueType.VOID,
                ValueType.object("java.lang.Object"), ValueType.arrayOf(ValueType.object("java.lang.Object")),
                ValueType.object("java.lang.invoke.MethodHandle"));
    }

    private void transformCoreApplicationEnvironment(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "addExtension", ValueType.VOID,
                ValueType.object("com.intellij.openapi.extensions.ExtensionPointName"),
                ValueType.object("java.lang.Object"));
        replaceWithNoOp(cls, context, "registerExtensionPointAndExtensions", ValueType.VOID,
                ValueType.object("java.nio.file.Path"), ValueType.object("java.lang.String"),
                ValueType.object("com.intellij.openapi.extensions.ExtensionsArea"));
    }

    private void transformMockApplication(ClassHolder cls, ClassHolderTransformerContext context) {
        var runnableType = ValueType.object("java.lang.Runnable");
        var modalityStateType = ValueType.object("com.intellij.openapi.application.ModalityState");
        var conditionType = ValueType.object("com.intellij.openapi.util.Condition");

        replaceWithNoOp(cls, context, "invokeLater", ValueType.VOID, runnableType);
        replaceWithNoOp(cls, context, "invokeLater", ValueType.VOID, runnableType, modalityStateType);
        replaceWithNoOp(cls, context, "invokeLater", ValueType.VOID, runnableType, conditionType);
        replaceWithNoOp(cls, context, "invokeLater", ValueType.VOID,
                runnableType, modalityStateType, conditionType);
        replaceWithNoOp(cls, context, "invokeLaterOnWriteThread", ValueType.VOID, runnableType);
        replaceWithNoOp(cls, context, "invokeLaterOnWriteThread", ValueType.VOID,
                runnableType, modalityStateType);
        replaceWithNoOp(cls, context, "invokeLaterOnWriteThread", ValueType.VOID,
                runnableType, modalityStateType, conditionType);
        replaceWithNoOp(cls, context, "invokeAndWait", ValueType.VOID, runnableType);
        replaceWithNoOp(cls, context, "invokeAndWait", ValueType.VOID, runnableType, modalityStateType);
        replaceWithCompletedFuture(cls, context, "executeOnPooledThread", runnableType);
        replaceWithCompletedFuture(cls, context, "executeOnPooledThread",
                ValueType.object("java.util.concurrent.Callable"));
    }

    private void transformJavacWrapper(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithConstantBoolean(cls, context, "compile", true, ValueType.object("java.io.File"));
        replaceWithNoOp(cls, context, "close", ValueType.VOID);
        replaceWithNull(cls, context, "findClass",
                ValueType.object("org.jetbrains.kotlin.load.java.structure.JavaClass"),
                ValueType.object("org.jetbrains.kotlin.name.ClassId"),
                ValueType.object("com.intellij.psi.search.GlobalSearchScope"));
        replaceWithNull(cls, context, "findPackage",
                ValueType.object("org.jetbrains.kotlin.load.java.structure.JavaPackage"),
                ValueType.object("org.jetbrains.kotlin.name.FqName"),
                ValueType.object("com.intellij.psi.search.GlobalSearchScope"));
        replaceWithEmptyList(cls, context, "findSubPackages",
                ValueType.object("org.jetbrains.kotlin.name.FqName"));
        replaceWithEmptyList(cls, context, "getPackageAnnotationsFromSources",
                ValueType.object("org.jetbrains.kotlin.name.FqName"));
        replaceWithEmptyList(cls, context, "findClassesFromPackage",
                ValueType.object("org.jetbrains.kotlin.name.FqName"));
        replaceWithEmptySet(cls, context, "knownClassNamesInPackage",
                ValueType.object("org.jetbrains.kotlin.name.FqName"));
        replaceWithNull(cls, context, "getKotlinClassifier",
                ValueType.object("org.jetbrains.kotlin.load.java.structure.JavaClass"),
                ValueType.object("org.jetbrains.kotlin.name.ClassId"));
        replaceWithConstantBoolean(cls, context, "isDeprecated", false,
                ValueType.object("javax.lang.model.element.Element"));
        replaceWithConstantBoolean(cls, context, "isDeprecated", false,
                ValueType.object("javax.lang.model.type.TypeMirror"));
    }

    private void transformJavacBasedClassFinder(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "initialize", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.object("org.jetbrains.kotlin.resolve.lazy.KotlinCodeAnalyzer"),
                ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings"),
                ValueType.object("org.jetbrains.kotlin.config.JvmTarget"));
        replaceWithNull(cls, context, "findClass",
                ValueType.object("org.jetbrains.kotlin.load.java.structure.JavaClass"),
                ValueType.object("org.jetbrains.kotlin.load.java.JavaClassFinder$Request"));
        replaceWithEmptyList(cls, context, "findClasses",
                ValueType.object("org.jetbrains.kotlin.load.java.JavaClassFinder$Request"));
        replaceWithNull(cls, context, "findPackage",
                ValueType.object("org.jetbrains.kotlin.load.java.structure.JavaPackage"),
                ValueType.object("org.jetbrains.kotlin.name.FqName"), ValueType.BOOLEAN);
        replaceWithEmptySet(cls, context, "knownClassNamesInPackage",
                ValueType.object("org.jetbrains.kotlin.name.FqName"));
        replaceWithConstantBoolean(cls, context, "canComputeKnownClassNamesInPackage", false);
    }

    private void transformAbstractJavaClassFinder(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "initialize", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.object("org.jetbrains.kotlin.resolve.lazy.KotlinCodeAnalyzer"),
                ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings"),
                ValueType.object("org.jetbrains.kotlin.config.JvmTarget"));
    }

    private void transformJavaClassFinderImpl(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "setProjectInstance", ValueType.VOID,
                ValueType.object("com.intellij.openapi.project.Project"));
        replaceWithNull(cls, context, "findClass",
                ValueType.object("org.jetbrains.kotlin.load.java.structure.JavaClass"),
                ValueType.object("org.jetbrains.kotlin.load.java.JavaClassFinder$Request"));
        replaceWithEmptyList(cls, context, "findClasses",
                ValueType.object("org.jetbrains.kotlin.load.java.JavaClassFinder$Request"));
        replaceWithNull(cls, context, "findPackage",
                ValueType.object("org.jetbrains.kotlin.load.java.structure.JavaPackage"),
                ValueType.object("org.jetbrains.kotlin.name.FqName"), ValueType.BOOLEAN);
        replaceWithEmptySet(cls, context, "knownClassNamesInPackage",
                ValueType.object("org.jetbrains.kotlin.name.FqName"));
        replaceWithConstantBoolean(cls, context, "canComputeKnownClassNamesInPackage", false);
    }

    private static void replaceWithDefaultCodeInsightContext(ClassHolder cls, ClassHolderTransformerContext context,
            String name, ValueType... argumentTypes) {
        var returnType = ValueType.object("com.intellij.codeInsight.multiverse.CodeInsightContext");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke("com.intellij.codeInsight.multiverse.CodeInsightContextKt",
                        "defaultContext", returnType)
                .returnValue();
    }

    private void transformCliCompiler(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("loadPlugins",
                ValueType.object("org.jetbrains.kotlin.utils.KotlinPaths"),
                ValueType.object("org.jetbrains.kotlin.cli.common.arguments.CommonCompilerArguments"),
                ValueType.object("org.jetbrains.kotlin.config.CompilerConfiguration"),
                ValueType.object("com.intellij.openapi.Disposable"),
                ValueType.object("org.jetbrains.kotlin.cli.common.ExitCode")));
        if (method == null) {
            return;
        }
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.getField("org.jetbrains.kotlin.cli.common.ExitCode", "OK",
                ValueType.object("org.jetbrains.kotlin.cli.common.ExitCode")).returnValue();
    }

    private void transformErrorsInitializer(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "initializeFactoryNames", ValueType.VOID,
                ValueType.object("java.lang.Class"));
        replaceWithNoOp(cls, context, "initializeFactoryNamesAndDefaultErrorMessages", ValueType.VOID,
                ValueType.object("java.lang.Class"),
                ValueType.object("org.jetbrains.kotlin.diagnostics.rendering.DefaultErrorMessages$Extension"));
    }

    private void transformDefaultErrorMessages(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "<clinit>", ValueType.VOID);
        replaceWithConstantString(cls, context, "render",
                ValueType.object("org.jetbrains.kotlin.diagnostics.UnboundDiagnostic"));
        replaceWithNull(cls, context, "getRendererForDiagnostic",
                ValueType.object("org.jetbrains.kotlin.diagnostics.rendering.DiagnosticRenderer"),
                ValueType.object("org.jetbrains.kotlin.diagnostics.UnboundDiagnostic"));
    }

    private static void makeConstructorsPublic(ClassHolder cls) {
        for (var method : cls.getMethods()) {
            if (method.getName().equals("<init>")) {
                method.setLevel(AccessLevel.PUBLIC);
            }
        }
    }

    private static void transformDiagnosticFactory(ClassHolder cls, ClassHolderTransformerContext context) {
        makeConstructorsPublic(cls);
        var factoryType = ValueType.object(cls.getName());
        var severityType = ValueType.object("org.jetbrains.kotlin.diagnostics.Severity");
        var positioningType = ValueType.object("org.jetbrains.kotlin.diagnostics.PositioningStrategy");

        var createDefault = cls.getMethod(new MethodDescriptor("create", severityType, factoryType));
        if (createDefault != null) {
            prepareMethodBody(createDefault);
            var pe = ProgramEmitter.create(createDefault, context.getHierarchy());
            pe.construct(cls.getName(), pe.var(1, severityType), pe.constantNull(positioningType))
                    .cast(factoryType)
                    .returnValue();
        }

        var createWithPositioning = cls.getMethod(new MethodDescriptor("create",
                severityType, positioningType, factoryType));
        if (createWithPositioning != null) {
            prepareMethodBody(createWithPositioning);
            var pe = ProgramEmitter.create(createWithPositioning, context.getHierarchy());
            pe.construct(cls.getName(), pe.var(1, severityType), pe.constantNull(positioningType))
                    .cast(factoryType)
                    .returnValue();
        }
    }

    private static void transformDiagnosticFactoryForDeprecation(ClassHolder cls,
            ClassHolderTransformerContext context) {
        makeConstructorsPublic(cls);
        var arity = cls.getName().charAt(cls.getName().length() - 1);
        var baseFactoryName = "org.jetbrains.kotlin.diagnostics.DiagnosticFactory" + arity;
        var deprecationFactoryType = ValueType.object(cls.getName());
        var baseFactoryType = ValueType.object(baseFactoryName);
        var featureType = ValueType.object("org.jetbrains.kotlin.config.LanguageFeature");
        var severityType = ValueType.object("org.jetbrains.kotlin.diagnostics.Severity");
        var positioningType = ValueType.object("org.jetbrains.kotlin.diagnostics.PositioningStrategy");

        var createDefault = cls.getMethod(new MethodDescriptor("create", featureType, deprecationFactoryType));
        if (createDefault != null) {
            prepareMethodBody(createDefault);
            var pe = ProgramEmitter.create(createDefault, context.getHierarchy());
            pe.construct(cls.getName(),
                    pe.var(1, featureType),
                    pe.invoke(baseFactoryName, "create", baseFactoryType,
                            pe.getField("org.jetbrains.kotlin.diagnostics.Severity", "WARNING", severityType),
                            pe.constantNull(positioningType)),
                    pe.invoke(baseFactoryName, "create", baseFactoryType,
                            pe.getField("org.jetbrains.kotlin.diagnostics.Severity", "ERROR", severityType),
                            pe.constantNull(positioningType)))
                    .cast(deprecationFactoryType)
                    .returnValue();
        }

        var createWithPositioning = cls.getMethod(new MethodDescriptor("create",
                featureType, positioningType, deprecationFactoryType));
        if (createWithPositioning != null) {
            prepareMethodBody(createWithPositioning);
            var pe = ProgramEmitter.create(createWithPositioning, context.getHierarchy());
            pe.construct(cls.getName(),
                    pe.var(1, featureType),
                    pe.invoke(baseFactoryName, "create", baseFactoryType,
                            pe.getField("org.jetbrains.kotlin.diagnostics.Severity", "WARNING", severityType),
                            pe.constantNull(positioningType)),
                    pe.invoke(baseFactoryName, "create", baseFactoryType,
                            pe.getField("org.jetbrains.kotlin.diagnostics.Severity", "ERROR", severityType),
                            pe.constantNull(positioningType)))
                    .cast(deprecationFactoryType)
                    .returnValue();
        }
    }

    private void transformStorageComponentContainer(ClassHolder cls, ClassHolderTransformerContext context) {
        var typeType = ValueType.object("java.lang.reflect.Type");
        var contextType = ValueType.object("org.jetbrains.kotlin.container.ValueResolveContext");
        var descriptorType = ValueType.object("org.jetbrains.kotlin.container.ValueDescriptor");
        var classType = ValueType.object("java.lang.Class");
        var objectType = ValueType.object("java.lang.Object");
        var containerType = ValueType.object("org.jetbrains.kotlin.container.StorageComponentContainer");
        var storageType = ValueType.object("org.jetbrains.kotlin.container.ComponentStorage");
        var checkerType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeChecker");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl");
        var storageManagerType = ValueType.object("org.jetbrains.kotlin.storage.StorageManager");
        var projectType = ValueType.object("com.intellij.openapi.project.Project");
        var picoType = ValueType.object("org.picocontainer.PicoContainer");
        var disposableType = ValueType.object("com.intellij.openapi.Disposable");
        var nameType = ValueType.object("org.jetbrains.kotlin.name.Name");
        var builtInsType = ValueType.object("org.jetbrains.kotlin.builtins.KotlinBuiltIns");
        var bindingTraceType = ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace");
        var topLevelDescriptorProviderType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.TopLevelDescriptorProvider");
        var fileScopeProviderType = ValueType.object("org.jetbrains.kotlin.resolve.lazy.FileScopeProvider");
        var declarationScopeProviderType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProvider");
        var globalContextType = ValueType.object("org.jetbrains.kotlin.context.GlobalContext");
        var absentDescriptorHandlerType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.AbsentDescriptorHandler");
        var identifierCheckerDefaultType = ValueType.object("org.jetbrains.kotlin.resolve.IdentifierChecker$Default");
        var defaultBuiltInsType = ValueType.object("org.jetbrains.kotlin.builtins.DefaultBuiltIns");
        var refinerDefaultType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default");
        var preparatorDefaultType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypePreparator$Default");
        var javaDeprecationSettingsType = ValueType.object(
                "org.jetbrains.kotlin.load.java.components.JavaDeprecationSettings");
        var javaResolverCacheType = ValueType.object(
                "org.jetbrains.kotlin.load.java.components.JavaResolverCache");
        var signaturePropagatorType = ValueType.object(
                "org.jetbrains.kotlin.load.java.components.SignaturePropagator");
        var deserializationConfigDefaultType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration$Default");
        var compilerDeserializationConfigType = ValueType.object(
                "org.jetbrains.kotlin.resolve.CompilerDeserializationConfiguration");
        var errorReporterType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.ErrorReporter");
        var lookupTrackerType = ValueType.object("org.jetbrains.kotlin.incremental.components.LookupTracker");
        var lookupTrackerDoNothingType = ValueType.object(
                "org.jetbrains.kotlin.incremental.components.LookupTracker$DO_NOTHING");
        var contractDeserializerType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.ContractDeserializer");
        var deserializationConfigType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration");
        var abstractJavaClassFinderType = ValueType.object("org.jetbrains.kotlin.load.java.AbstractJavaClassFinder");
        var kotlinCodeAnalyzerType = ValueType.object("org.jetbrains.kotlin.resolve.lazy.KotlinCodeAnalyzer");
        var resolveSessionType = ValueType.object("org.jetbrains.kotlin.resolve.lazy.ResolveSession");
        var javaClassesTrackerType = ValueType.object("org.jetbrains.kotlin.load.java.JavaClassesTracker");
        var javaClassesTrackerDefaultType = ValueType.object(
                "org.jetbrains.kotlin.load.java.JavaClassesTracker$Default");
        var moduleType = ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor");
        var moduleContextType = ValueType.object("org.jetbrains.kotlin.context.ModuleContext");
        var declarationProviderFactoryType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.declarations.DeclarationProviderFactory");
        var collectionType = ValueType.object("java.util.Collection");
        var newCheckerType = ValueType.object("org.jetbrains.kotlin.types.checker.NewKotlinTypeChecker");
        var refinerType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner");
        var preparatorType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypePreparator");

        var method = cls.getMethod(new MethodDescriptor("resolve", typeType, contextType, descriptorType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        var request = pe.var(1, typeType);
        var resolveContext = pe.var(2, contextType);
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.ResolveSession.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("org.wasmidle.kotlin.teavm.SimpleKotlinAnalysisBridge", "service", objectType,
                                pe.constant(org.jetbrains.kotlin.resolve.lazy.ResolveSession.class).cast(classType),
                                resolveContext)
                                .cast(objectType))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.KotlinCodeAnalyzer.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("org.wasmidle.kotlin.teavm.SimpleKotlinAnalysisBridge", "service", objectType,
                                pe.constant(org.jetbrains.kotlin.resolve.lazy.KotlinCodeAnalyzer.class).cast(classType),
                                resolveContext)
                                .cast(objectType))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.TopLevelDescriptorProvider.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("org.wasmidle.kotlin.teavm.SimpleKotlinAnalysisBridge", "service", objectType,
                                pe.constant(org.jetbrains.kotlin.resolve.lazy.TopLevelDescriptorProvider.class)
                                        .cast(classType),
                                resolveContext)
                                .cast(objectType))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("org.wasmidle.kotlin.teavm.SimpleKotlinAnalysisBridge", "service", objectType,
                                pe.constant(org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver.class)
                                        .cast(classType),
                                resolveContext)
                                .cast(objectType))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.FileScopeProvider.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("org.wasmidle.kotlin.teavm.SimpleKotlinAnalysisBridge", "service", objectType,
                                pe.constant(org.jetbrains.kotlin.resolve.lazy.FileScopeProvider.class).cast(classType),
                                resolveContext)
                                .cast(objectType))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProvider.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("org.wasmidle.kotlin.teavm.SimpleKotlinAnalysisBridge", "service", objectType,
                                pe.constant(org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProvider.class)
                                        .cast(classType),
                                resolveContext)
                                .cast(objectType))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.types.checker.KotlinTypeChecker.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeChecker", "DEFAULT", checkerType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(
                pe.constant(org.jetbrains.kotlin.config.LanguageVersionSettings.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.storage.StorageManager.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.builtins.KotlinBuiltIns.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                defaultBuiltInsType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.BindingTrace.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace",
                                pe.construct("com.intellij.mock.MockProject",
                                        pe.constantNull(picoType),
                                        pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                disposableType))
                                        .cast(projectType))
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.descriptors.ModuleDescriptor.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                        pe.constant("<wasm-idle>")),
                                pe.construct("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                        pe.constant("wasm-idle"))
                                        .cast(storageManagerType),
                                pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                        defaultBuiltInsType)
                                        .cast(builtInsType))
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.IdentifierChecker.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.resolve.IdentifierChecker$Default", "INSTANCE",
                                identifierCheckerDefaultType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.load.java.components.JavaResolverCache.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.load.java.components.JavaResolverCache", "EMPTY",
                                javaResolverCacheType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.load.java.components.SignaturePropagator.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.load.java.components.SignaturePropagator", "DO_NOTHING",
                                signaturePropagatorType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.types.checker.KotlinTypeRefiner.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default", "INSTANCE",
                                refinerDefaultType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.types.checker.KotlinTypePreparator.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypePreparator$Default", "INSTANCE",
                                preparatorDefaultType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.resolve.deprecation.DeprecationSettings.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.load.java.components.JavaDeprecationSettings", "INSTANCE",
                                javaDeprecationSettingsType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(
                org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration$Default",
                                "INSTANCE", deserializationConfigDefaultType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(
                org.jetbrains.kotlin.resolve.CompilerDeserializationConfiguration.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.construct("org.jetbrains.kotlin.resolve.CompilerDeserializationConfiguration",
                                pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                        languageSettingsType)
                                        .cast(ValueType.object(
                                                "org.jetbrains.kotlin.config.LanguageVersionSettings")))
                                .cast(compilerDeserializationConfigType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(
                org.jetbrains.kotlin.serialization.deserialization.ErrorReporter.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.serialization.deserialization.ErrorReporter", "DO_NOTHING",
                                errorReporterType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.incremental.components.LookupTracker.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.incremental.components.LookupTracker$DO_NOTHING",
                                "INSTANCE", lookupTrackerDoNothingType)
                                .cast(lookupTrackerType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(
                org.jetbrains.kotlin.serialization.deserialization.ContractDeserializer.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.construct("org.jetbrains.kotlin.contracts.ContractDeserializerImpl",
                                pe.getField("org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration$Default",
                                        "INSTANCE", deserializationConfigDefaultType)
                                        .cast(deserializationConfigType),
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType))
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.types.checker.NewKotlinTypeChecker.class)
                .cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.construct("org.jetbrains.kotlin.types.checker.NewKotlinTypeCheckerImpl",
                                pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default",
                                        "INSTANCE", refinerDefaultType)
                                        .cast(refinerType),
                                pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypePreparator$Default",
                                        "INSTANCE", preparatorDefaultType)
                                        .cast(preparatorType))
                                .cast(newCheckerType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.load.java.JavaClassesTracker.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.getField("org.jetbrains.kotlin.load.java.JavaClassesTracker$Default", "INSTANCE",
                                javaClassesTrackerDefaultType)
                                .cast(javaClassesTrackerType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.load.java.AbstractJavaClassFinder.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.construct("org.jetbrains.kotlin.load.java.JavaClassFinderImpl")
                                .cast(abstractJavaClassFinderType)
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(org.jetbrains.kotlin.context.ModuleContext.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("org.jetbrains.kotlin.context.ContextKt", "ModuleContext", moduleContextType,
                                pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                        pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                                pe.constant("<wasm-idle>")),
                                        pe.construct("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                                pe.constant("wasm-idle"))
                                                .cast(storageManagerType),
                                        pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                                defaultBuiltInsType)
                                                .cast(builtInsType))
                                        .cast(moduleType),
                                pe.construct("com.intellij.mock.MockProject",
                                        pe.constantNull(picoType),
                                        pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                disposableType))
                                        .cast(projectType),
                                pe.constant("wasm-idle"))
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        pe.when(request.isSame(pe.constant(Iterable.class).cast(typeType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.container.InstanceComponentDescriptor",
                        pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                                .cast(ValueType.object("java.lang.Object")))
                        .cast(descriptorType)
                        .returnValue());
        var resolved = pe.var(0, containerType)
                .getField("componentStorage", storageType)
                .invokeVirtual("resolve", descriptorType, request, resolveContext);
        pe.when(resolved.isNotNull()).thenDo(resolved::returnValue);
        pe.var(0, containerType)
                .invokeSpecial("resolveIterable", descriptorType, request, resolveContext)
                .returnValue();
    }

    private void transformBindingTraceContext(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "report", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.diagnostics.Diagnostic"));
        replaceWithConstantBoolean(cls, context, "wantsDiagnostics", false);
    }

    private void transformNoScopeRecordCliBindingTrace(ClassHolder cls, ClassHolderTransformerContext context) {
        var traceType = ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace");
        var constructor = getOrCreateMethod(cls, "<init>", ValueType.VOID,
                ValueType.object("com.intellij.openapi.project.Project"));
        var pe = ProgramEmitter.create(constructor, context.getHierarchy());
        pe.var(0, traceType).invokeSpecial("<init>", ValueType.VOID);
        pe.exit();
    }

    private void transformLazyTopDownAnalyzer(ClassHolder cls, ClassHolderTransformerContext context) {
        var analyzerType = ValueType.object("org.jetbrains.kotlin.resolve.LazyTopDownAnalyzer");
        var traceType = ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace");
        var declarationResolverType = ValueType.object("org.jetbrains.kotlin.resolve.DeclarationResolver");
        var overrideResolverType = ValueType.object("org.jetbrains.kotlin.resolve.OverrideResolver");
        var overloadResolverType = ValueType.object("org.jetbrains.kotlin.resolve.OverloadResolver");
        var varianceCheckerType = ValueType.object("org.jetbrains.kotlin.resolve.VarianceChecker");
        var moduleType = ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor");
        var lazyDeclarationResolverType = ValueType.object("org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver");
        var bodyResolverType = ValueType.object("org.jetbrains.kotlin.resolve.BodyResolver");
        var topLevelDescriptorProviderType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.TopLevelDescriptorProvider");
        var fileScopeProviderType = ValueType.object("org.jetbrains.kotlin.resolve.lazy.FileScopeProvider");
        var declarationScopeProviderType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProvider");
        var qualifiedExpressionResolverType = ValueType.object(
                "org.jetbrains.kotlin.resolve.QualifiedExpressionResolver");
        var identifierCheckerType = ValueType.object("org.jetbrains.kotlin.resolve.IdentifierChecker");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var deprecationResolverType = ValueType.object("org.jetbrains.kotlin.resolve.deprecation.DeprecationResolver");
        var iterableType = ValueType.object("java.lang.Iterable");
        var filePreprocessorType = ValueType.object("org.jetbrains.kotlin.resolve.FilePreprocessor");
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                traceType, declarationResolverType, overrideResolverType, overloadResolverType,
                varianceCheckerType, moduleType, lazyDeclarationResolverType, bodyResolverType,
                topLevelDescriptorProviderType, fileScopeProviderType, declarationScopeProviderType,
                qualifiedExpressionResolverType, identifierCheckerType, languageSettingsType,
                deprecationResolverType, iterableType, filePreprocessorType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, analyzerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, analyzerType).setField("trace", pe.var(1, traceType));
            pe.var(0, analyzerType).setField("declarationResolver", pe.var(2, declarationResolverType));
            pe.var(0, analyzerType).setField("overrideResolver", pe.var(3, overrideResolverType));
            pe.var(0, analyzerType).setField("overloadResolver", pe.var(4, overloadResolverType));
            pe.var(0, analyzerType).setField("varianceChecker", pe.var(5, varianceCheckerType));
            pe.var(0, analyzerType).setField("moduleDescriptor", pe.var(6, moduleType));
            pe.var(0, analyzerType).setField("lazyDeclarationResolver", pe.var(7, lazyDeclarationResolverType));
            pe.var(0, analyzerType).setField("bodyResolver", pe.var(8, bodyResolverType));
            pe.var(0, analyzerType).setField("topLevelDescriptorProvider",
                    pe.var(9, topLevelDescriptorProviderType));
            pe.var(0, analyzerType).setField("fileScopeProvider", pe.var(10, fileScopeProviderType));
            pe.var(0, analyzerType).setField("declarationScopeProvider",
                    pe.var(11, declarationScopeProviderType));
            pe.var(0, analyzerType).setField("qualifiedExpressionResolver",
                    pe.var(12, qualifiedExpressionResolverType));
            pe.var(0, analyzerType).setField("identifierChecker", pe.var(13, identifierCheckerType));
            pe.var(0, analyzerType).setField("languageVersionSettings", pe.var(14, languageSettingsType));
            pe.var(0, analyzerType).setField("deprecationResolver", pe.var(15, deprecationResolverType));
            pe.var(0, analyzerType).setField("classifierUsageCheckers", pe.var(16, iterableType));
            pe.var(0, analyzerType).setField("filePreprocessor", pe.var(17, filePreprocessorType));
            pe.exit();
        }

    }

    private void transformFilePreprocessor(ClassHolder cls, ClassHolderTransformerContext context) {
        var ktFileType = ValueType.object("org.jetbrains.kotlin.psi.KtFile");
        var method = getOrCreateMethod(cls, "preprocessFile", ValueType.VOID, ktFileType);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("org.wasmidle.kotlin.teavm.SimpleSourceRegistry", "add", ValueType.VOID,
                pe.var(1, ktFileType));
        pe.exit();
    }

    private void transformOverrideResolver(ClassHolder cls, ClassHolderTransformerContext context) {
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.object("org.jetbrains.kotlin.resolve.OverridesBackwardCompatibilityHelper"),
                ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings"),
                ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner"),
                ValueType.object("org.jetbrains.kotlin.platform.PlatformSpecificDiagnosticComponents"),
                ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, ValueType.object("org.jetbrains.kotlin.resolve.OverrideResolver"))
                    .invokeSpecial(Object.class, "<init>");
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.TopDownAnalysisContext"));
    }

    private void transformOverloadResolver(ClassHolder cls, ClassHolderTransformerContext context) {
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.object("org.jetbrains.kotlin.resolve.OverloadFilter"),
                ValueType.object("org.jetbrains.kotlin.resolve.OverloadChecker"),
                ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings"),
                ValueType.object("org.jetbrains.kotlin.idea.MainFunctionDetector$Factory"),
                ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, ValueType.object("org.jetbrains.kotlin.resolve.OverloadResolver"))
                    .invokeSpecial(Object.class, "<init>");
            pe.exit();
        }
        replaceWithNoOp(cls, context, "checkOverloads", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.BodiesResolveContext"));
    }

    private void transformVarianceChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.TopDownAnalysisContext"));
    }

    private void transformBodyResolver(ClassHolder cls, ClassHolderTransformerContext context) {
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("com.intellij.openapi.project.Project"),
                ValueType.object("org.jetbrains.kotlin.resolve.AnnotationResolver"),
                ValueType.object("org.jetbrains.kotlin.resolve.BodyResolveCache"),
                ValueType.object("org.jetbrains.kotlin.resolve.calls.CallResolver"),
                ValueType.object("org.jetbrains.kotlin.resolve.ControlFlowAnalyzer"),
                ValueType.object("org.jetbrains.kotlin.resolve.DeclarationsChecker"),
                ValueType.object("org.jetbrains.kotlin.resolve.DelegatedPropertyResolver"),
                ValueType.object("org.jetbrains.kotlin.types.expressions.ExpressionTypingServices"),
                ValueType.object("org.jetbrains.kotlin.resolve.AnalyzerExtensions"),
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.object("org.jetbrains.kotlin.types.expressions.ValueParameterResolver"),
                ValueType.object("org.jetbrains.kotlin.resolve.AnnotationChecker"),
                ValueType.object("org.jetbrains.kotlin.builtins.KotlinBuiltIns"),
                ValueType.object("org.jetbrains.kotlin.resolve.OverloadChecker"),
                ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings"),
                ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, ValueType.object("org.jetbrains.kotlin.resolve.BodyResolver"))
                    .invokeSpecial(Object.class, "<init>");
            pe.exit();
        }
        replaceWithNoOp(cls, context, "resolveBodies", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.BodiesResolveContext"));
    }

    private void transformContainerKt(ClassHolder cls, ClassHolderTransformerContext context) {
        var containerType = ValueType.object("org.jetbrains.kotlin.container.StorageComponentContainer");
        var componentContainerType = ValueType.object("org.jetbrains.kotlin.container.ComponentContainer");
        var descriptorType = ValueType.object("org.jetbrains.kotlin.container.SingletonTypeComponentDescriptor");
        var classType = ValueType.object("java.lang.Class");
        var objectType = ValueType.object("java.lang.Object");
        var stringType = ValueType.object("java.lang.String");
        var listType = ValueType.object("java.util.List");

        var method = cls.getMethod(new MethodDescriptor("registerSingleton", containerType, classType, containerType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.when(pe.var(2, classType).isSame(pe.constantNull(classType)))
                .thenDo(() -> pe.var(1, containerType).returnValue());
        pe.when(pe.var(2, classType).invokeVirtual("getName", stringType).isSame(pe.constantNull(stringType)))
                .thenDo(() -> pe.var(1, containerType).returnValue());
        pe.when(pe.var(2, classType).isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.ResolveSession.class)
                .cast(classType)))
                .thenDo(() -> pe.var(1, containerType).returnValue());
        pe.var(1, containerType)
                .invokeVirtual("registerDescriptors$container", containerType,
                        pe.invoke("java.util.Collections", "singletonList", listType,
                                pe.construct("org.jetbrains.kotlin.container.SingletonTypeComponentDescriptor",
                                        pe.var(1, containerType).cast(componentContainerType),
                                        pe.var(2, classType))
                                        .cast(objectType)))
                .returnValue();
    }

    private void transformDslKt(ClassHolder cls, ClassHolderTransformerContext context) {
        var componentProviderType = ValueType.object("org.jetbrains.kotlin.container.ComponentProvider");
        var valueDescriptorType = ValueType.object("org.jetbrains.kotlin.container.ValueDescriptor");
        var classType = ValueType.object("java.lang.Class");
        var objectType = ValueType.object("java.lang.Object");
        var typeType = ValueType.object("java.lang.reflect.Type");

        var method = cls.getMethod(new MethodDescriptor("tryGetService", componentProviderType, classType,
                objectType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        var resolved = pe.var(1, componentProviderType)
                .invokeVirtual("resolve", valueDescriptorType, pe.var(2, classType).cast(typeType));
        pe.when(resolved.isNotNull()).thenDo(() -> resolved.invokeVirtual("getValue", objectType).returnValue());
        var bridged = pe.invoke("org.wasmidle.kotlin.teavm.SimpleKotlinAnalysisBridge", "service", objectType,
                pe.var(2, classType));
        pe.when(bridged.isNotNull()).thenDo(bridged::returnValue);
        pe.constantNull(objectType).returnValue();
    }

    private void transformFunctionDescriptorResolver(ClassHolder cls, ClassHolderTransformerContext context) {
        var resolverType = ValueType.object("org.jetbrains.kotlin.resolve.FunctionDescriptorResolver");
        var typeResolverType = ValueType.object("org.jetbrains.kotlin.resolve.TypeResolver");
        var descriptorResolverType = ValueType.object("org.jetbrains.kotlin.resolve.DescriptorResolver");
        var annotationResolverType = ValueType.object("org.jetbrains.kotlin.resolve.AnnotationResolver");
        var builtInsType = ValueType.object("org.jetbrains.kotlin.builtins.KotlinBuiltIns");
        var modifiersCheckerType = ValueType.object("org.jetbrains.kotlin.resolve.ModifiersChecker");
        var overloadCheckerType = ValueType.object("org.jetbrains.kotlin.resolve.OverloadChecker");
        var contractParsingServicesType = ValueType.object(
                "org.jetbrains.kotlin.contracts.parsing.ContractParsingServices");
        var expressionTypingServicesType = ValueType.object(
                "org.jetbrains.kotlin.types.expressions.ExpressionTypingServices");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var storageManagerType = ValueType.object("org.jetbrains.kotlin.storage.StorageManager");
        var declarationDescriptorType = ValueType.object("org.jetbrains.kotlin.descriptors.DeclarationDescriptor");
        var lexicalScopeType = ValueType.object("org.jetbrains.kotlin.resolve.scopes.LexicalScope");
        var namedFunctionType = ValueType.object("org.jetbrains.kotlin.psi.KtNamedFunction");
        var bindingTraceType = ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace");
        var dataFlowInfoType = ValueType.object("org.jetbrains.kotlin.resolve.calls.smartcasts.DataFlowInfo");
        var inferenceSessionType = ValueType.object("org.jetbrains.kotlin.resolve.calls.components.InferenceSession");
        var simpleFunctionDescriptorType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.SimpleFunctionDescriptor");
        var simpleFunctionDescriptorImplType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.impl.SimpleFunctionDescriptorImpl");
        var annotationsType = ValueType.object("org.jetbrains.kotlin.descriptors.annotations.Annotations");
        var annotationsCompanionType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.annotations.Annotations$Companion");
        var nameType = ValueType.object("org.jetbrains.kotlin.name.Name");
        var kindType = ValueType.object("org.jetbrains.kotlin.descriptors.CallableMemberDescriptor$Kind");
        var sourceElementType = ValueType.object("org.jetbrains.kotlin.descriptors.SourceElement");
        var ktPureElementType = ValueType.object("org.jetbrains.kotlin.psi.KtPureElement");
        var receiverParameterType = ValueType.object("org.jetbrains.kotlin.descriptors.ReceiverParameterDescriptor");
        var listType = ValueType.object("java.util.List");
        var kotlinType = ValueType.object("org.jetbrains.kotlin.types.KotlinType");
        var simpleType = ValueType.object("org.jetbrains.kotlin.types.SimpleType");
        var modalityType = ValueType.object("org.jetbrains.kotlin.descriptors.Modality");
        var descriptorVisibilityType = ValueType.object("org.jetbrains.kotlin.descriptors.DescriptorVisibility");

        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                typeResolverType,
                descriptorResolverType,
                annotationResolverType,
                builtInsType,
                modifiersCheckerType,
                overloadCheckerType,
                contractParsingServicesType,
                expressionTypingServicesType,
                languageSettingsType,
                storageManagerType,
                ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, resolverType).invokeSpecial(Object.class, "<init>");
            pe.exit();
        }

        var resolveFunctionDescriptor = cls.getMethod(new MethodDescriptor("resolveFunctionDescriptor",
                declarationDescriptorType,
                lexicalScopeType,
                namedFunctionType,
                bindingTraceType,
                dataFlowInfoType,
                inferenceSessionType,
                simpleFunctionDescriptorType));
        if (resolveFunctionDescriptor != null) {
            prepareMethodBody(resolveFunctionDescriptor);
            var pe = ProgramEmitter.create(resolveFunctionDescriptor, context.getHierarchy());
            emitSimpleFunctionDescriptor(pe, declarationDescriptorType, namedFunctionType,
                    bindingTraceType,
                    simpleFunctionDescriptorImplType, simpleFunctionDescriptorType, annotationsType,
                    annotationsCompanionType, nameType, kindType, sourceElementType, ktPureElementType,
                    receiverParameterType, listType, kotlinType, modalityType, descriptorVisibilityType,
                    simpleType);
        }
    }

    private void emitSimpleFunctionDescriptor(ProgramEmitter pe,
            ValueType declarationDescriptorType,
            ValueType namedFunctionType,
            ValueType bindingTraceType,
            ValueType simpleFunctionDescriptorImplType,
            ValueType simpleFunctionDescriptorType,
            ValueType annotationsType,
            ValueType annotationsCompanionType,
            ValueType nameType,
            ValueType kindType,
            ValueType sourceElementType,
            ValueType ktPureElementType,
            ValueType receiverParameterType,
            ValueType listType,
            ValueType kotlinType,
            ValueType modalityType,
            ValueType descriptorVisibilityType,
            ValueType simpleType) {
        pe.invoke("org.wasmidle.kotlin.teavm.SimpleFunctionDescriptorResolvers", "resolveFunctionDescriptor",
                simpleFunctionDescriptorType,
                pe.var(1, declarationDescriptorType),
                pe.var(3, namedFunctionType),
                pe.var(4, bindingTraceType))
                .returnValue();
    }

    private void transformKtNodeType(ClassHolder cls, ClassHolderTransformerContext context) {
        var ktNodeType = ValueType.object("org.jetbrains.kotlin.KtNodeType");
        var constructorType = ValueType.object("java.lang.reflect.Constructor");
        var astNodeType = ValueType.object("com.intellij.lang.ASTNode");
        var ktElementType = ValueType.object("org.jetbrains.kotlin.psi.KtElement");
        var method = cls.getMethod(new MethodDescriptor("createPsi", astNodeType, ktElementType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("org.wasmidle.kotlin.teavm.SimplePsiFactories", "create", ktElementType,
                pe.var(0, ktNodeType).getField("myPsiFactory", constructorType),
                pe.var(1, astNodeType))
                .returnValue();
    }

    private void transformFunctionCodegen(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("gen",
                ValueType.object("org.jetbrains.kotlin.psi.KtNamedFunction"), ValueType.VOID));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var functionCodegenType = ValueType.object("org.jetbrains.kotlin.codegen.FunctionCodegen");
        var classBuilderType = ValueType.object("org.jetbrains.kotlin.codegen.ClassBuilder");
        var namedFunctionType = ValueType.object("org.jetbrains.kotlin.psi.KtNamedFunction");
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("org.wasmidle.kotlin.teavm.SimpleFunctionCodegens", "gen", ValueType.VOID,
                pe.var(0, functionCodegenType).getField("v", classBuilderType),
                pe.var(1, namedFunctionType));
        pe.exit();
    }

    private void transformNameUtils(ClassHolder cls, ClassHolderTransformerContext context) {
        var stringType = ValueType.object("java.lang.String");
        var sanitize = cls.getMethod(new MethodDescriptor("sanitizeAsJavaIdentifier", stringType, stringType));
        if (sanitize != null) {
            prepareMethodBody(sanitize);
            var pe = ProgramEmitter.create(sanitize, context.getHierarchy());
            pe.invoke("org.wasmidle.kotlin.teavm.SimpleNameUtils", "sanitizeAsJavaIdentifier",
                    stringType, pe.var(1, stringType))
                    .returnValue();
        }
        var packagePartPrefix = cls.getMethod(
                new MethodDescriptor("getPackagePartClassNamePrefix", stringType, stringType));
        if (packagePartPrefix != null) {
            prepareMethodBody(packagePartPrefix);
            var pe = ProgramEmitter.create(packagePartPrefix, context.getHierarchy());
            pe.invoke("org.wasmidle.kotlin.teavm.SimpleNameUtils", "getPackagePartClassNamePrefix",
                    stringType, pe.var(1, stringType))
                    .returnValue();
        }
    }

    private void transformAnnotationResolverImpl(ClassHolder cls, ClassHolderTransformerContext context) {
        var annotationResolverType = ValueType.object("org.jetbrains.kotlin.resolve.AnnotationResolverImpl");
        var callResolverType = ValueType.object("org.jetbrains.kotlin.resolve.calls.CallResolver");
        var constantExpressionEvaluatorType = ValueType.object(
                "org.jetbrains.kotlin.resolve.constants.evaluate.ConstantExpressionEvaluator");
        var storageManagerType = ValueType.object("org.jetbrains.kotlin.storage.StorageManager");
        var typeResolverType = ValueType.object("org.jetbrains.kotlin.resolve.TypeResolver");

        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                callResolverType, constantExpressionEvaluatorType, storageManagerType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, annotationResolverType).invokeSpecial("org.jetbrains.kotlin.resolve.AnnotationResolver",
                    "<init>");
            pe.var(0, annotationResolverType).setField("callResolver", pe.var(1, callResolverType));
            pe.var(0, annotationResolverType).setField("constantExpressionEvaluator",
                    pe.var(2, constantExpressionEvaluatorType));
            pe.var(0, annotationResolverType).setField("storageManager", pe.var(3, storageManagerType));
            pe.exit();
        }

        var setTypeResolver = cls.getMethod(new MethodDescriptor("setTypeResolver",
                typeResolverType, ValueType.VOID));
        if (setTypeResolver != null) {
            prepareMethodBody(setTypeResolver);
            var pe = ProgramEmitter.create(setTypeResolver, context.getHierarchy());
            pe.var(0, annotationResolverType).setField("typeResolver", pe.var(1, typeResolverType));
            pe.exit();
        }

        var annotationsType = ValueType.object("org.jetbrains.kotlin.descriptors.annotations.Annotations");
        var annotationsCompanionType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.annotations.Annotations$Companion");
        var resolveAnnotationEntries = cls.getMethod(new MethodDescriptor("resolveAnnotationEntries",
                annotationsType,
                ValueType.object("org.jetbrains.kotlin.resolve.scopes.LexicalScope"),
                ValueType.object("java.util.List"),
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.BOOLEAN));
        if (resolveAnnotationEntries != null) {
            prepareMethodBody(resolveAnnotationEntries);
            ProgramEmitter.create(resolveAnnotationEntries, context.getHierarchy())
                    .getField("org.jetbrains.kotlin.descriptors.annotations.Annotations", "Companion",
                            annotationsCompanionType)
                    .invokeVirtual("getEMPTY", annotationsType)
                    .returnValue();
        }

        replaceWithNull(cls, context, "resolveAnnotationType",
                ValueType.object("org.jetbrains.kotlin.types.KotlinType"),
                ValueType.object("org.jetbrains.kotlin.resolve.scopes.LexicalScope"),
                ValueType.object("org.jetbrains.kotlin.psi.KtAnnotationEntry"),
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"));
        replaceWithNull(cls, context, "resolveAnnotationCall",
                ValueType.object("org.jetbrains.kotlin.resolve.calls.results.OverloadResolutionResults"),
                ValueType.object("org.jetbrains.kotlin.psi.KtAnnotationEntry"),
                ValueType.object("org.jetbrains.kotlin.resolve.scopes.LexicalScope"),
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"));
        replaceWithNull(cls, context, "getAnnotationArgumentValue",
                ValueType.object("org.jetbrains.kotlin.resolve.constants.ConstantValue"),
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.object("org.jetbrains.kotlin.descriptors.ValueParameterDescriptor"),
                ValueType.object("org.jetbrains.kotlin.resolve.calls.model.ResolvedValueArgument"));
    }

    private void transformAnnotationCodegen(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "<clinit>", ValueType.VOID);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        var owner = "org.jetbrains.kotlin.codegen.AnnotationCodegen";
        if (cls.getField("FIELD_FLAGS") != null) {
            pe.setField(owner, "FIELD_FLAGS",
                    pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List")));
        }
        if (cls.getField("METHOD_FLAGS") != null) {
            pe.setField(owner, "METHOD_FLAGS",
                    pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List")));
        }
        if (cls.getField("NO_ANNOTATION_VISITOR") != null) {
            pe.setField(owner, "NO_ANNOTATION_VISITOR",
                    pe.construct("org.jetbrains.kotlin.codegen.AnnotationCodegen$1", pe.constant(589824))
                            .cast(ValueType.object("org.jetbrains.org.objectweb.asm.AnnotationVisitor")));
        }
        if (cls.getField("annotationTargetMap") != null) {
            pe.setField(owner, "annotationTargetMap",
                    pe.invoke("java.util.Collections", "emptyMap", ValueType.object("java.util.Map")));
        }
        if (cls.getField("annotationRetentionMap") != null) {
            pe.setField(owner, "annotationRetentionMap",
                    pe.invoke("java.util.Collections", "emptyMap", ValueType.object("java.util.Map")));
        }
        if (cls.getField("$assertionsDisabled") != null) {
            pe.setField(owner, "$assertionsDisabled", pe.constant(1));
        }
        pe.exit();
    }

    private void transformJavaDescriptorResolver(ClassHolder cls, ClassHolderTransformerContext context) {
        var resolverType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.JavaDescriptorResolver");
        var packageFragmentProviderType = ValueType.object(
                "org.jetbrains.kotlin.load.java.lazy.LazyJavaPackageFragmentProvider");
        var javaResolverCacheType = ValueType.object(
                "org.jetbrains.kotlin.load.java.components.JavaResolverCache");

        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                packageFragmentProviderType, javaResolverCacheType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, resolverType).invokeSpecial(Object.class, "<init>");
            pe.var(0, resolverType).setField("packageFragmentProvider", pe.var(1, packageFragmentProviderType));
            pe.var(0, resolverType).setField("javaResolverCache", pe.var(2, javaResolverCacheType));
            pe.exit();
        }

        replaceWithNull(cls, context, "resolveClass",
                ValueType.object("org.jetbrains.kotlin.descriptors.ClassDescriptor"),
                ValueType.object("org.jetbrains.kotlin.load.java.structure.JavaClass"));
    }

    private void transformDeserializedDescriptorResolver(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNull(cls, context, "getComponents",
                ValueType.object("org.jetbrains.kotlin.serialization.deserialization.DeserializationComponents"));
        replaceWithNoOp(cls, context, "setComponents", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.serialization.deserialization.DeserializationComponents"));
        replaceWithNoOp(cls, context, "setComponents", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.load.kotlin.DeserializationComponentsForJava"));
        replaceWithNull(cls, context, "resolveClass",
                ValueType.object("org.jetbrains.kotlin.descriptors.ClassDescriptor"),
                ValueType.object("org.jetbrains.kotlin.load.kotlin.KotlinJvmBinaryClass"));
        replaceWithNull(cls, context, "readClassData$descriptors_jvm",
                ValueType.object("org.jetbrains.kotlin.serialization.deserialization.ClassData"),
                ValueType.object("org.jetbrains.kotlin.load.kotlin.KotlinJvmBinaryClass"));
        replaceWithNull(cls, context, "createKotlinPackagePartScope",
                ValueType.object("org.jetbrains.kotlin.resolve.scopes.MemberScope"),
                ValueType.object("org.jetbrains.kotlin.descriptors.PackageFragmentDescriptor"),
                ValueType.object("org.jetbrains.kotlin.load.kotlin.KotlinJvmBinaryClass"));
    }

    private void transformDeserializationComponentsForJava(ClassHolder cls, ClassHolderTransformerContext context) {
        var componentsForJavaType = ValueType.object("org.jetbrains.kotlin.load.kotlin.DeserializationComponentsForJava");
        var storageManagerType = ValueType.object("org.jetbrains.kotlin.storage.StorageManager");
        var moduleType = ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor");
        var configType = ValueType.object("org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration");
        var javaClassDataFinderType = ValueType.object("org.jetbrains.kotlin.load.kotlin.JavaClassDataFinder");
        var annotationLoaderType = ValueType.object(
                "org.jetbrains.kotlin.load.kotlin.BinaryClassAnnotationAndConstantLoaderImpl");
        var packageProviderType = ValueType.object(
                "org.jetbrains.kotlin.load.java.lazy.LazyJavaPackageFragmentProvider");
        var notFoundClassesType = ValueType.object("org.jetbrains.kotlin.descriptors.NotFoundClasses");
        var errorReporterType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.ErrorReporter");
        var lookupTrackerType = ValueType.object("org.jetbrains.kotlin.incremental.components.LookupTracker");
        var contractDeserializerType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.ContractDeserializer");
        var newCheckerType = ValueType.object("org.jetbrains.kotlin.types.checker.NewKotlinTypeChecker");
        var translatorsType = ValueType.object("org.jetbrains.kotlin.types.extensions.TypeAttributeTranslators");
        var componentsType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.DeserializationComponents");

        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                storageManagerType, moduleType, configType, javaClassDataFinderType, annotationLoaderType,
                packageProviderType, notFoundClassesType, errorReporterType, lookupTrackerType,
                contractDeserializerType, newCheckerType, translatorsType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, componentsForJavaType).invokeSpecial(Object.class, "<init>");
            pe.var(0, componentsForJavaType).setField("components", pe.constantNull(componentsType));
            pe.exit();
        }
    }

    private void transformJvmReflectionApiCallChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.checkers.JvmReflectionAPICallChecker");
        var reflectionTypesType = ValueType.object("org.jetbrains.kotlin.builtins.ReflectionTypes");
        var storageManagerType = ValueType.object("org.jetbrains.kotlin.storage.StorageManager");
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor"),
                reflectionTypesType,
                storageManagerType,
                ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType)
                    .invokeSpecial("org.jetbrains.kotlin.resolve.calls.checkers.AbstractReflectionApiCallChecker",
                            "<init>", ValueType.VOID,
                            pe.var(2, reflectionTypesType),
                            pe.var(3, storageManagerType));
            pe.exit();
        }
        replaceWithConstantBoolean(cls, context, "isWholeReflectionApiAvailable", false);
        replaceWithNoOp(cls, context, "report", ValueType.VOID,
                ValueType.object("com.intellij.psi.PsiElement"),
                ValueType.object("org.jetbrains.kotlin.resolve.calls.checkers.CallCheckerContext"));
    }

    private void transformInterfaceDefaultMethodCallChecker(ClassHolder cls,
            ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.checkers.InterfaceDefaultMethodCallChecker");
        var jvmTargetType = ValueType.object("org.jetbrains.kotlin.config.JvmTarget");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", jvmTargetType,
                ValueType.object("com.intellij.openapi.project.Project"), ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, checkerType).setField("jvmTarget", pe.var(1, jvmTargetType));
            pe.var(0, checkerType).setField("ideService",
                    pe.constantNull(ValueType.object("org.jetbrains.kotlin.resolve.LanguageVersionSettingsProvider")));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.calls.model.ResolvedCall"),
                ValueType.object("com.intellij.psi.PsiElement"),
                ValueType.object("org.jetbrains.kotlin.resolve.calls.checkers.CallCheckerContext"));
    }

    private void transformJvmDefaultChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.checkers.JvmDefaultChecker");
        var jvmTargetType = ValueType.object("org.jetbrains.kotlin.config.JvmTarget");
        var projectType = ValueType.object("com.intellij.openapi.project.Project");
        var constructor = getOrCreateMethod(cls, "<init>", ValueType.VOID, projectType);
        var pe = ProgramEmitter.create(constructor, context.getHierarchy());
        pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
        if (cls.getField("jvmTarget") != null) {
            pe.var(0, checkerType).setField("jvmTarget", pe.constantNull(jvmTargetType));
        }
        if (cls.getField("ideService") != null) {
            pe.var(0, checkerType).setField("ideService",
                    pe.constantNull(ValueType.object("org.jetbrains.kotlin.resolve.LanguageVersionSettingsProvider")));
        }
        pe.exit();

        constructor = cls.getMethod(new MethodDescriptor("<init>", jvmTargetType, projectType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            if (cls.getField("jvmTarget") != null) {
                pe.var(0, checkerType).setField("jvmTarget", pe.var(1, jvmTargetType));
            }
            if (cls.getField("ideService") != null) {
                pe.var(0, checkerType).setField("ideService",
                        pe.constantNull(ValueType.object("org.jetbrains.kotlin.resolve.LanguageVersionSettingsProvider")));
            }
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.psi.KtDeclaration"),
                ValueType.object("org.jetbrains.kotlin.descriptors.DeclarationDescriptor"),
                ValueType.object("org.jetbrains.kotlin.resolve.checkers.DeclarationCheckerContext"));
    }

    private void transformJvmRecordApplicabilityChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.checkers.JvmRecordApplicabilityChecker");
        var jvmTargetType = ValueType.object("org.jetbrains.kotlin.config.JvmTarget");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", jvmTargetType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, checkerType).setField("jvmTarget", pe.var(1, jvmTargetType));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.psi.KtDeclaration"),
                ValueType.object("org.jetbrains.kotlin.descriptors.DeclarationDescriptor"),
                ValueType.object("org.jetbrains.kotlin.resolve.checkers.DeclarationCheckerContext"));
    }

    private void transformInlinePlatformCompatibilityChecker(ClassHolder cls,
            ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.checkers.InlinePlatformCompatibilityChecker");
        var jvmTargetType = ValueType.object("org.jetbrains.kotlin.config.JvmTarget");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var constructor = getOrCreateMethod(cls, "<init>", ValueType.VOID, jvmTargetType);
        var pe = ProgramEmitter.create(constructor, context.getHierarchy());
        pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
        if (cls.getField("jvmTarget") != null) {
            pe.var(0, checkerType).setField("jvmTarget", pe.var(1, jvmTargetType));
        }
        if (cls.getField("properError") != null) {
            pe.var(0, checkerType).setField("properError", pe.constant(0));
        }
        if (cls.getField("doCheck") != null) {
            pe.var(0, checkerType).setField("doCheck", pe.constant(0));
        }
        pe.exit();

        constructor = cls.getMethod(new MethodDescriptor("<init>", jvmTargetType, languageSettingsType,
                ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            if (cls.getField("jvmTarget") != null) {
                pe.var(0, checkerType).setField("jvmTarget", pe.var(1, jvmTargetType));
            }
            if (cls.getField("properError") != null) {
                pe.var(0, checkerType).setField("properError", pe.constant(0));
            }
            if (cls.getField("doCheck") != null) {
                pe.var(0, checkerType).setField("doCheck", pe.constant(0));
            }
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.calls.model.ResolvedCall"),
                ValueType.object("com.intellij.psi.PsiElement"),
                ValueType.object("org.jetbrains.kotlin.resolve.calls.checkers.CallCheckerContext"));
    }

    private void transformJvmModuleAccessibilityChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker");
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("com.intellij.openapi.project.Project"), ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, checkerType).setField("moduleResolver",
                    pe.constantNull(ValueType.object("org.jetbrains.kotlin.resolve.jvm.modules.JavaModuleResolver")));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.calls.model.ResolvedCall"),
                ValueType.object("com.intellij.psi.PsiElement"),
                ValueType.object("org.jetbrains.kotlin.resolve.calls.checkers.CallCheckerContext"));
    }

    private void transformJvmModuleAccessibilityCheckerClassifierUsage(ClassHolder cls,
            ClassHolderTransformerContext context) {
        var checkerType = ValueType.object(
                "org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker$ClassifierUsage");
        var ownerType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", ownerType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, checkerType).setField("this$0", pe.var(1, ownerType));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.descriptors.ClassifierDescriptor"),
                ValueType.object("com.intellij.psi.PsiElement"),
                ValueType.object("org.jetbrains.kotlin.resolve.checkers.ClassifierUsageCheckerContext"));
    }

    private void transformJvmTypeSpecificityComparator(ClassHolder cls, ClassHolderTransformerContext context) {
        var comparatorType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.JvmTypeSpecificityComparator");
        var contextType = ValueType.object("org.jetbrains.kotlin.types.model.TypeSystemInferenceExtensionContext");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", contextType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, comparatorType).invokeSpecial(Object.class, "<init>");
            pe.var(0, comparatorType).setField("context", pe.var(1, contextType));
            pe.exit();
        }
        constructor = getOrCreateMethod(cls, "<init>", ValueType.VOID, contextType, languageSettingsType);
        var pe = ProgramEmitter.create(constructor, context.getHierarchy());
        pe.var(0, comparatorType).invokeSpecial(Object.class, "<init>");
        pe.var(0, comparatorType).setField("context", pe.var(1, contextType));
        if (cls.getField("languageVersionSettings") != null) {
            pe.var(0, comparatorType).setField("languageVersionSettings", pe.var(2, languageSettingsType));
        }
        pe.exit();
        replaceWithConstantBoolean(cls, context, "isDefinitelyLessSpecific", false,
                ValueType.object("org.jetbrains.kotlin.types.model.KotlinTypeMarker"),
                ValueType.object("org.jetbrains.kotlin.types.model.KotlinTypeMarker"));
    }

    private void transformJvmTypeSpecificityComparatorDelegate(ClassHolder cls,
            ClassHolderTransformerContext context) {
        var delegateType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.JvmTypeSpecificityComparatorDelegate");
        var contextDelegateType = ValueType.object(
                "org.jetbrains.kotlin.types.model.TypeSystemInferenceExtensionContextDelegate");
        var contextType = ValueType.object("org.jetbrains.kotlin.types.model.TypeSystemInferenceExtensionContext");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", contextDelegateType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, delegateType)
                    .invokeSpecial("org.jetbrains.kotlin.resolve.jvm.JvmTypeSpecificityComparator", "<init>",
                            ValueType.VOID,
                            pe.var(1, contextDelegateType).cast(contextType));
            pe.var(0, delegateType).setField("context", pe.var(1, contextDelegateType));
            pe.exit();
        }
        constructor = getOrCreateMethod(cls, "<init>", ValueType.VOID, contextDelegateType, languageSettingsType);
        var pe = ProgramEmitter.create(constructor, context.getHierarchy());
        pe.var(0, delegateType)
                .invokeSpecial("org.jetbrains.kotlin.resolve.jvm.JvmTypeSpecificityComparator", "<init>",
                        ValueType.VOID, pe.var(1, contextDelegateType).cast(contextType));
        pe.var(0, delegateType).setField("context", pe.var(1, contextDelegateType));
        pe.exit();
        replaceWithConstantBoolean(cls, context, "isDefinitelyLessSpecific", false,
                ValueType.object("org.jetbrains.kotlin.types.model.KotlinTypeMarker"),
                ValueType.object("org.jetbrains.kotlin.types.model.KotlinTypeMarker"));
    }

    private void transformJvmPlatformOverloadsSpecificityComparator(ClassHolder cls,
            ClassHolderTransformerContext context) {
        var comparatorType = ValueType.object(
                "org.jetbrains.kotlin.resolve.jvm.JvmPlatformOverloadsSpecificityComparator");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", languageSettingsType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, comparatorType).invokeSpecial(Object.class, "<init>");
            pe.var(0, comparatorType).setField("languageVersionSettings", pe.var(1, languageSettingsType));
            pe.exit();
        }
        replaceWithConstantBoolean(cls, context, "isMoreSpecificShape", false,
                ValueType.object("org.jetbrains.kotlin.descriptors.CallableDescriptor"),
                ValueType.object("org.jetbrains.kotlin.descriptors.CallableDescriptor"));
    }

    private void transformOptInMarkerDeclarationAnnotationChecker(ClassHolder cls,
            ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.checkers.OptInMarkerDeclarationAnnotationChecker");
        var moduleType = ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", moduleType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, checkerType).setField("module", pe.var(1, moduleType));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "checkEntries", ValueType.VOID,
                ValueType.object("java.util.List"),
                ValueType.object("java.util.List"),
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.object("org.jetbrains.kotlin.psi.KtAnnotated"),
                ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings"));
    }

    private void transformOptInUsageChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.resolve.calls.model.ResolvedCall"),
                ValueType.object("com.intellij.psi.PsiElement"),
                ValueType.object("org.jetbrains.kotlin.resolve.calls.checkers.CallCheckerContext"));
    }

    private void transformOptInUsageCheckerOverrides(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.psi.KtDeclaration"),
                ValueType.object("org.jetbrains.kotlin.descriptors.DeclarationDescriptor"),
                ValueType.object("org.jetbrains.kotlin.resolve.checkers.DeclarationCheckerContext"));
    }

    private void transformOptInUsageCheckerClassifierUsage(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.descriptors.ClassifierDescriptor"),
                ValueType.object("com.intellij.psi.PsiElement"),
                ValueType.object("org.jetbrains.kotlin.resolve.checkers.ClassifierUsageCheckerContext"));
    }

    private void transformExpectedActualDeclarationChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.checkers.ExpectedActualDeclarationChecker");
        var moduleStructureOracleType = ValueType.object("org.jetbrains.kotlin.resolve.ModuleStructureOracle");
        var iterableType = ValueType.object("java.lang.Iterable");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", moduleStructureOracleType, iterableType,
                ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, checkerType).setField("moduleStructureOracle", pe.var(1, moduleStructureOracleType));
            pe.var(0, checkerType).setField("argumentExtractors", pe.var(2, iterableType));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "check", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.psi.KtDeclaration"),
                ValueType.object("org.jetbrains.kotlin.descriptors.DeclarationDescriptor"),
                ValueType.object("org.jetbrains.kotlin.resolve.checkers.DeclarationCheckerContext"));
    }

    private void transformRepeatableAnnotationChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.resolve.jvm.checkers.RepeatableAnnotationChecker");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var jvmTargetType = ValueType.object("org.jetbrains.kotlin.config.JvmTarget");
        var annotationFeaturesType = ValueType.object(
                "org.jetbrains.kotlin.resolve.jvm.JvmPlatformAnnotationFeaturesSupport");
        var moduleType = ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", languageSettingsType, jvmTargetType,
                annotationFeaturesType, moduleType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, checkerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, checkerType).setField("languageVersionSettings", pe.var(1, languageSettingsType));
            pe.var(0, checkerType).setField("jvmTarget", pe.var(2, jvmTargetType));
            pe.var(0, checkerType).setField("platformAnnotationFeaturesSupport", pe.var(3, annotationFeaturesType));
            pe.var(0, checkerType).setField("module", pe.var(4, moduleType));
            pe.exit();
        }
        replaceWithNoOp(cls, context, "checkEntries", ValueType.VOID,
                ValueType.object("java.util.List"),
                ValueType.object("java.util.List"),
                ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace"),
                ValueType.object("org.jetbrains.kotlin.psi.KtAnnotated"),
                ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings"));
    }

    private void transformJavaSyntheticScopes(ClassHolder cls, ClassHolderTransformerContext context) {
        var projectType = ValueType.object("com.intellij.openapi.project.Project");
        var moduleType = ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor");
        var storageManagerType = ValueType.object("org.jetbrains.kotlin.storage.StorageManager");
        var lookupTrackerType = ValueType.object("org.jetbrains.kotlin.incremental.components.LookupTracker");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var samResolverType = ValueType.object("org.jetbrains.kotlin.resolve.sam.SamConversionResolver");
        var samOracleType = ValueType.object("org.jetbrains.kotlin.resolve.sam.SamConversionOracle");
        var deprecationResolverType = ValueType.object("org.jetbrains.kotlin.resolve.deprecation.DeprecationResolver");
        var typeRefinerType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner");
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                projectType, moduleType, storageManagerType, lookupTrackerType, languageSettingsType,
                samResolverType, samOracleType, deprecationResolverType, typeRefinerType, ValueType.VOID));
        if (constructor != null) {
            prepareMethodBody(constructor);
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, ValueType.object("org.jetbrains.kotlin.synthetic.JavaSyntheticScopes"))
                    .invokeSpecial(Object.class, "<init>");
            pe.exit();
        }
        var collectionType = ValueType.object("java.util.Collection");
        var getScopes = cls.getMethod(new MethodDescriptor("getScopes", collectionType));
        if (getScopes != null) {
            prepareMethodBody(getScopes);
            ProgramEmitter.create(getScopes, context.getHierarchy())
                    .invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                    .cast(collectionType)
                    .returnValue();
        }
        var getScopesWithSamAdapters = cls.getMethod(
                new MethodDescriptor("getScopesWithForceEnabledSamAdapters", collectionType));
        if (getScopesWithSamAdapters != null) {
            prepareMethodBody(getScopesWithSamAdapters);
            ProgramEmitter.create(getScopesWithSamAdapters, context.getHierarchy())
                    .invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                    .cast(collectionType)
                    .returnValue();
        }
    }

    private void transformPackageCodegenImpl(ClassHolder cls, ClassHolderTransformerContext context) {
        var fqNameType = ValueType.object("org.jetbrains.kotlin.name.FqName");
        var stateType = ValueType.object("org.jetbrains.kotlin.codegen.state.GenerationState");
        var moduleType = ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor");
        var packageFragmentType = ValueType.object("org.jetbrains.kotlin.descriptors.PackageFragmentDescriptor");

        var method = cls.getMethod(new MethodDescriptor("getOnlyPackageFragment", fqNameType, packageFragmentType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct("org.jetbrains.kotlin.descriptors.impl.EmptyPackageFragmentDescriptor",
                pe.var(0, ValueType.object("org.jetbrains.kotlin.codegen.PackageCodegenImpl"))
                        .getField("state", stateType)
                        .invokeVirtual("getModule", moduleType),
                pe.var(1, fqNameType))
                .cast(packageFragmentType)
                .returnValue();
    }

    private void transformModuleDescriptorWholeModuleProvider(ClassHolder cls, ClassHolderTransformerContext context) {
        var objectType = ValueType.object("java.lang.Object");
        var providerType = ValueType.object("org.jetbrains.kotlin.descriptors.PackageFragmentProvider");
        var providerEmptyType = ValueType.object("org.jetbrains.kotlin.descriptors.PackageFragmentProvider$Empty");
        var compositeProviderType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.impl.CompositePackageFragmentProvider");
        var listType = ValueType.object("java.util.List");

        var invoke = getOrCreateMethod(cls, "invoke", compositeProviderType);
        var pe = ProgramEmitter.create(invoke, context.getHierarchy());
        pe.construct("org.jetbrains.kotlin.descriptors.impl.CompositePackageFragmentProvider",
                pe.invoke("java.util.Collections", "singletonList", listType,
                        pe.getField("org.jetbrains.kotlin.descriptors.PackageFragmentProvider$Empty", "INSTANCE",
                                providerEmptyType)
                                .cast(providerType)
                                .cast(objectType)),
                pe.constant("wasm-idle-empty-module"))
                .returnValue();

        var bridge = getOrCreateMethod(cls, "invoke", objectType);
        pe = ProgramEmitter.create(bridge, context.getHierarchy());
        pe.var(0, ValueType.object(
                        "org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl$packageFragmentProviderForWholeModuleWithDependencies$2"))
                .invokeVirtual("invoke", compositeProviderType)
                .cast(objectType)
                .returnValue();
    }

    private void transformSingletonTypeComponentDescriptor(ClassHolder cls, ClassHolderTransformerContext context) {
        var contextType = ValueType.object("org.jetbrains.kotlin.container.ValueResolveContext");
        var classType = ValueType.object("java.lang.Class");
        var objectType = ValueType.object("java.lang.Object");
        var stringType = ValueType.object("java.lang.String");
        var descriptorType = ValueType.object("org.jetbrains.kotlin.container.SingletonTypeComponentDescriptor");
        var checkerType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeChecker");
        var languageSettingsType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl");
        var moduleType = ValueType.object("org.jetbrains.kotlin.descriptors.ModuleDescriptor");
        var moduleImplType = ValueType.object("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl");
        var reflectionTypesType = ValueType.object("org.jetbrains.kotlin.builtins.ReflectionTypes");
        var storageManagerType = ValueType.object("org.jetbrains.kotlin.storage.StorageManager");
        var projectType = ValueType.object("com.intellij.openapi.project.Project");
        var lookupTrackerType = ValueType.object("org.jetbrains.kotlin.incremental.components.LookupTracker");
        var languageSettingsInterfaceType = ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings");
        var samResolverType = ValueType.object("org.jetbrains.kotlin.resolve.sam.SamConversionResolver");
        var samOracleType = ValueType.object("org.jetbrains.kotlin.resolve.sam.SamConversionOracle");
        var deprecationResolverType = ValueType.object("org.jetbrains.kotlin.resolve.deprecation.DeprecationResolver");
        var typeRefinerType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner");
        var kotlinClassFinderType = ValueType.object("org.jetbrains.kotlin.load.kotlin.KotlinClassFinder");
        var additionalClassPartsProviderType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.deserialization.AdditionalClassPartsProvider");
        var additionalClassPartsProviderNoneType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.deserialization.AdditionalClassPartsProvider$None");
        var platformDependentDeclarationFilterType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.deserialization.PlatformDependentDeclarationFilter");
        var platformDependentDeclarationFilterAllType = ValueType.object(
                "org.jetbrains.kotlin.descriptors.deserialization.PlatformDependentDeclarationFilter$All");
        var packagePartProviderType = ValueType.object("org.jetbrains.kotlin.load.kotlin.PackagePartProvider");
        var packagePartProviderEmptyType = ValueType.object(
                "org.jetbrains.kotlin.load.kotlin.PackagePartProvider$Empty");
        var javaTypeEnhancementStateType = ValueType.object(
                "org.jetbrains.kotlin.load.java.JavaTypeEnhancementState");
        var annotationTypeQualifierResolverType = ValueType.object(
                "org.jetbrains.kotlin.load.java.AnnotationTypeQualifierResolver");
        var iterableType = ValueType.object("java.lang.Iterable");
        var jvmTargetType = ValueType.object("org.jetbrains.kotlin.config.JvmTarget");
        var contextDelegateType = ValueType.object(
                "org.jetbrains.kotlin.types.model.TypeSystemInferenceExtensionContextDelegate");
        var moduleStructureOracleType = ValueType.object("org.jetbrains.kotlin.resolve.ModuleStructureOracle");
        var annotationFeaturesType = ValueType.object(
                "org.jetbrains.kotlin.resolve.jvm.JvmPlatformAnnotationFeaturesSupport");
        var picoType = ValueType.object("org.picocontainer.PicoContainer");
        var disposableType = ValueType.object("com.intellij.openapi.Disposable");
        var globalContextType = ValueType.object("org.jetbrains.kotlin.context.GlobalContext");
        var lockBasedStorageManagerType = ValueType.object("org.jetbrains.kotlin.storage.LockBasedStorageManager");
        var exceptionTrackerType = ValueType.object("org.jetbrains.kotlin.storage.ExceptionTracker");
        var nameType = ValueType.object("org.jetbrains.kotlin.name.Name");
        var bindingTraceType = ValueType.object("org.jetbrains.kotlin.resolve.BindingTrace");
        var declarationProviderFactoryType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.declarations.DeclarationProviderFactory");
        var newCheckerType = ValueType.object("org.jetbrains.kotlin.types.checker.NewKotlinTypeChecker");
        var collectionType = ValueType.object("java.util.Collection");
        var refinerType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner");
        var preparatorType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypePreparator");
        var refinerDefaultType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default");
        var preparatorDefaultType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypePreparator$Default");
        var deprecationSettingsType = ValueType.object("org.jetbrains.kotlin.resolve.deprecation.DeprecationSettings");
        var javaDeprecationSettingsType = ValueType.object(
                "org.jetbrains.kotlin.load.java.components.JavaDeprecationSettings");
        var deserializationConfigType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration");
        var deserializationConfigDefaultType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration$Default");
        var compilerDeserializationConfigType = ValueType.object(
                "org.jetbrains.kotlin.resolve.CompilerDeserializationConfiguration");
        var builtInsType = ValueType.object("org.jetbrains.kotlin.builtins.KotlinBuiltIns");
        var defaultBuiltInsType = ValueType.object("org.jetbrains.kotlin.builtins.DefaultBuiltIns");
        var lazyTopDownAnalyzerType = ValueType.object("org.jetbrains.kotlin.resolve.LazyTopDownAnalyzer");
        var resolveSessionType = ValueType.object("org.jetbrains.kotlin.resolve.lazy.ResolveSession");
        var declarationResolverType = ValueType.object("org.jetbrains.kotlin.resolve.DeclarationResolver");
        var overrideResolverType = ValueType.object("org.jetbrains.kotlin.resolve.OverrideResolver");
        var overloadResolverType = ValueType.object("org.jetbrains.kotlin.resolve.OverloadResolver");
        var varianceCheckerType = ValueType.object("org.jetbrains.kotlin.resolve.VarianceChecker");
        var lazyDeclarationResolverType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver");
        var bodyResolverType = ValueType.object("org.jetbrains.kotlin.resolve.BodyResolver");
        var topLevelDescriptorProviderType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.TopLevelDescriptorProvider");
        var fileScopeProviderType = ValueType.object("org.jetbrains.kotlin.resolve.lazy.FileScopeProvider");
        var declarationScopeProviderType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.DeclarationScopeProvider");
        var absentDescriptorHandlerType = ValueType.object(
                "org.jetbrains.kotlin.resolve.lazy.AbsentDescriptorHandler");
        var qualifiedExpressionResolverType = ValueType.object(
                "org.jetbrains.kotlin.resolve.QualifiedExpressionResolver");
        var identifierCheckerType = ValueType.object("org.jetbrains.kotlin.resolve.IdentifierChecker");
        var identifierCheckerDefaultType = ValueType.object("org.jetbrains.kotlin.resolve.IdentifierChecker$Default");
        var filePreprocessorType = ValueType.object("org.jetbrains.kotlin.resolve.FilePreprocessor");
        var lazyJavaPackageProviderType = ValueType.object(
                "org.jetbrains.kotlin.load.java.lazy.LazyJavaPackageFragmentProvider");
        var javaResolverCacheType = ValueType.object(
                "org.jetbrains.kotlin.load.java.components.JavaResolverCache");
        var javaClassDataFinderType = ValueType.object("org.jetbrains.kotlin.load.kotlin.JavaClassDataFinder");
        var binaryAnnotationLoaderType = ValueType.object(
                "org.jetbrains.kotlin.load.kotlin.BinaryClassAnnotationAndConstantLoaderImpl");
        var notFoundClassesType = ValueType.object("org.jetbrains.kotlin.descriptors.NotFoundClasses");
        var signaturePropagatorType = ValueType.object(
                "org.jetbrains.kotlin.load.java.components.SignaturePropagator");
        var errorReporterType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.ErrorReporter");
        var lookupTrackerDoNothingType = ValueType.object(
                "org.jetbrains.kotlin.incremental.components.LookupTracker$DO_NOTHING");
        var contractDeserializerType = ValueType.object(
                "org.jetbrains.kotlin.serialization.deserialization.ContractDeserializer");
        var typeAttributeTranslatorsType = ValueType.object(
                "org.jetbrains.kotlin.types.extensions.TypeAttributeTranslators");
        var callResolverType = ValueType.object("org.jetbrains.kotlin.resolve.calls.CallResolver");
        var constantExpressionEvaluatorType = ValueType.object(
                "org.jetbrains.kotlin.resolve.constants.evaluate.ConstantExpressionEvaluator");

        var method = cls.getMethod(new MethodDescriptor("createInstance", contextType, objectType));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        var klass = pe.var(0, descriptorType).getField("klass", classType);
        pe.when(klass.isSame(pe.constantNull(classType)))
                .thenDo(() -> pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                        .cast(objectType)
                        .returnValue());
        pe.when(klass.invokeVirtual("getName", stringType).isSame(pe.constantNull(stringType)))
                .thenDo(() -> pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.UpperBoundChecker.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.UpperBoundChecker",
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeChecker", "DEFAULT", checkerType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.checkers.WarningAwareUpperBoundChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.checkers.WarningAwareUpperBoundChecker",
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeChecker", "DEFAULT", checkerType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.checkers.JavaNullabilityChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.checkers.JavaNullabilityChecker",
                        pe.construct("org.jetbrains.kotlin.resolve.UpperBoundChecker",
                                pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeChecker", "DEFAULT",
                                        checkerType)))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.checkers.JvmStaticChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.checkers.JvmStaticChecker",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(ValueType.object("org.jetbrains.kotlin.config.LanguageVersionSettings")))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.checkers.JvmReflectionAPICallChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.checkers.JvmReflectionAPICallChecker",
                        pe.constantNull(moduleType),
                        pe.constantNull(reflectionTypesType),
                        pe.constantNull(storageManagerType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.synthetic.JavaSyntheticScopes.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.synthetic.JavaSyntheticScopes",
                        pe.constantNull(projectType),
                        pe.constantNull(moduleType),
                        pe.constantNull(storageManagerType),
                        pe.constantNull(lookupTrackerType),
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType),
                        pe.constantNull(samResolverType),
                        pe.constantNull(samOracleType),
                        pe.constantNull(deprecationResolverType),
                        pe.constantNull(typeRefinerType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.sam.SamConversionResolverImpl.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.sam.SamConversionResolverImpl",
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType),
                        pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                                .cast(iterableType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.checkers.InterfaceDefaultMethodCallChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.jvm.checkers.InterfaceDefaultMethodCallChecker",
                        pe.getField("org.jetbrains.kotlin.config.JvmTarget", "DEFAULT", jvmTargetType),
                        pe.constantNull(projectType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.checkers.JvmDefaultChecker.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.checkers.JvmDefaultChecker",
                        pe.constantNull(projectType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.checkers.JvmRecordApplicabilityChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.jvm.checkers.JvmRecordApplicabilityChecker",
                        pe.getField("org.jetbrains.kotlin.config.JvmTarget", "DEFAULT", jvmTargetType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.checkers.InlinePlatformCompatibilityChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.jvm.checkers.InlinePlatformCompatibilityChecker",
                        pe.getField("org.jetbrains.kotlin.config.JvmTarget", "DEFAULT", jvmTargetType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker",
                        pe.constantNull(projectType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker.ClassifierUsage.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker$ClassifierUsage",
                        pe.construct("org.jetbrains.kotlin.resolve.jvm.checkers.JvmModuleAccessibilityChecker",
                                pe.constantNull(projectType)))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.JvmTypeSpecificityComparatorDelegate.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.JvmTypeSpecificityComparatorDelegate",
                        pe.constantNull(contextDelegateType),
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.JvmPlatformOverloadsSpecificityComparator.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.jvm.JvmPlatformOverloadsSpecificityComparator",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.java.sam.JvmSamConversionOracle.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.java.sam.JvmSamConversionOracle",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.JvmAdditionalClassPartsProvider.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.JvmAdditionalClassPartsProvider")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.FilePreprocessor.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.FilePreprocessor",
                        pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace",
                                pe.construct("com.intellij.mock.MockProject",
                                        pe.constantNull(picoType),
                                        pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                disposableType))
                                        .cast(projectType))
                                .cast(bindingTraceType),
                        pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                                .cast(iterableType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.QualifiedExpressionResolver.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.QualifiedExpressionResolver",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.JvmPlatformAnnotationFeaturesSupport.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.JvmPlatformAnnotationFeaturesSupport",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.checkers.OptInMarkerDeclarationAnnotationChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.checkers.OptInMarkerDeclarationAnnotationChecker",
                        pe.constantNull(moduleType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker.Overrides.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker$Overrides")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker.ClassifierUsage.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.checkers.OptInUsageChecker$ClassifierUsage")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.checkers.ExpectedActualDeclarationChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.checkers.ExpectedActualDeclarationChecker",
                        pe.constantNull(moduleStructureOracleType),
                        pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                                .cast(iterableType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.checkers.RepeatableAnnotationChecker.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.checkers.RepeatableAnnotationChecker",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType),
                        pe.getField("org.jetbrains.kotlin.config.JvmTarget", "DEFAULT", jvmTargetType),
                        pe.construct("org.jetbrains.kotlin.resolve.jvm.JvmPlatformAnnotationFeaturesSupport",
                                pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                        languageSettingsType)
                                        .cast(languageSettingsInterfaceType))
                                .cast(annotationFeaturesType),
                        pe.constantNull(moduleType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.types.checker.NewKotlinTypeCheckerImpl.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.types.checker.NewKotlinTypeCheckerImpl",
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default", "INSTANCE",
                                refinerDefaultType)
                                .cast(refinerType),
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypePreparator$Default", "INSTANCE",
                                preparatorDefaultType)
                                .cast(preparatorType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.descriptors.NotFoundClasses.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.descriptors.NotFoundClasses",
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType),
                        pe.invoke("org.wasmidle.kotlin.teavm.SimpleModuleDescriptors", "create",
                                moduleImplType, pe.constant("<wasm-idle>"))
                                .cast(moduleType))
                        .cast(notFoundClassesType)
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.builtins.ReflectionTypes.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.builtins.ReflectionTypes",
                        pe.invoke("org.wasmidle.kotlin.teavm.SimpleModuleDescriptors", "create",
                                moduleImplType, pe.constant("<wasm-idle>"))
                                .cast(moduleType),
                        pe.construct("org.jetbrains.kotlin.descriptors.NotFoundClasses",
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.invoke("org.wasmidle.kotlin.teavm.SimpleModuleDescriptors", "create",
                                        moduleImplType, pe.constant("<wasm-idle>"))
                                        .cast(moduleType))
                                .cast(notFoundClassesType))
                        .cast(reflectionTypesType)
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.SupertypeLoopCheckerImpl.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.SupertypeLoopCheckerImpl")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.deprecation.DeprecationResolver.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.deprecation.DeprecationResolver",
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType),
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType),
                        pe.getField("org.jetbrains.kotlin.load.java.components.JavaDeprecationSettings", "INSTANCE",
                                javaDeprecationSettingsType)
                                .cast(deprecationSettingsType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.calls.tower.KotlinResolutionStatelessCallbacksImpl.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.calls.tower.KotlinResolutionStatelessCallbacksImpl",
                        pe.construct("org.jetbrains.kotlin.resolve.deprecation.DeprecationResolver",
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                        languageSettingsType)
                                        .cast(languageSettingsInterfaceType),
                                pe.getField("org.jetbrains.kotlin.load.java.components.JavaDeprecationSettings",
                                        "INSTANCE", javaDeprecationSettingsType)
                                        .cast(deprecationSettingsType)),
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType),
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default", "INSTANCE",
                                refinerDefaultType)
                                .cast(refinerType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.calls.smartcasts.DataFlowValueFactoryImpl.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.calls.smartcasts.DataFlowValueFactoryImpl",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.calls.components.ClassicTypeSystemContextForCS.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.calls.components.ClassicTypeSystemContextForCS",
                        pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                defaultBuiltInsType)
                                .cast(builtInsType),
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default", "INSTANCE",
                                refinerDefaultType)
                                .cast(refinerType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.calls.inference.components.ClassicConstraintSystemUtilContext.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.calls.inference.components.ClassicConstraintSystemUtilContext",
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default", "INSTANCE",
                                refinerDefaultType)
                                .cast(refinerType),
                        pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                defaultBuiltInsType)
                                .cast(builtInsType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.AnnotationResolverImpl.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.AnnotationResolverImpl",
                        pe.constantNull(callResolverType),
                        pe.constantNull(constantExpressionEvaluatorType),
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.JavaDescriptorResolver.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.JavaDescriptorResolver",
                        pe.constantNull(lazyJavaPackageProviderType),
                        pe.getField("org.jetbrains.kotlin.load.java.components.JavaResolverCache", "EMPTY",
                                javaResolverCacheType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.java.JavaClassFinderImpl.class).cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.java.JavaClassFinderImpl")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.java.components.JavaSourceElementFactoryImpl.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.java.components.JavaSourceElementFactoryImpl")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.builtins.jvm.JvmBuiltInsPackageFragmentProvider.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.builtins.jvm.JvmBuiltInsPackageFragmentProvider",
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType),
                        pe.construct("org.wasmidle.kotlin.teavm.SimpleKotlinClassFinder")
                                .cast(kotlinClassFinderType),
                        pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                        pe.constant("<wasm-idle>")),
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                        defaultBuiltInsType)
                                        .cast(builtInsType))
                                .cast(moduleType),
                        pe.construct("org.jetbrains.kotlin.descriptors.NotFoundClasses",
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                        pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                                pe.constant("<wasm-idle>")),
                                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                                "NO_LOCKS", storageManagerType),
                                        pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                                defaultBuiltInsType)
                                                .cast(builtInsType))
                                        .cast(moduleType))
                                .cast(notFoundClassesType),
                        pe.getField("org.jetbrains.kotlin.descriptors.deserialization.AdditionalClassPartsProvider$None",
                                "INSTANCE", additionalClassPartsProviderNoneType)
                                .cast(additionalClassPartsProviderType),
                        pe.getField("org.jetbrains.kotlin.descriptors.deserialization.PlatformDependentDeclarationFilter$All",
                                "INSTANCE", platformDependentDeclarationFilterAllType)
                                .cast(platformDependentDeclarationFilterType),
                        pe.getField("org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration$Default",
                                "INSTANCE", deserializationConfigDefaultType)
                                .cast(deserializationConfigType),
                        pe.construct("org.jetbrains.kotlin.types.checker.NewKotlinTypeCheckerImpl",
                                pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default",
                                        "INSTANCE", refinerDefaultType)
                                        .cast(refinerType),
                                pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypePreparator$Default",
                                        "INSTANCE", preparatorDefaultType)
                                        .cast(preparatorType))
                                .cast(newCheckerType),
                        pe.construct("org.jetbrains.kotlin.resolve.sam.SamConversionResolverImpl",
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                                        .cast(iterableType))
                                .cast(samResolverType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(
                        org.jetbrains.kotlin.resolve.jvm.multiplatform.OptionalAnnotationPackageFragmentProvider.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct(
                        "org.jetbrains.kotlin.resolve.jvm.multiplatform.OptionalAnnotationPackageFragmentProvider",
                        pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                        pe.constant("<wasm-idle>")),
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                        defaultBuiltInsType)
                                        .cast(builtInsType))
                                .cast(moduleType),
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType),
                        pe.construct("org.jetbrains.kotlin.descriptors.NotFoundClasses",
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                        pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                                pe.constant("<wasm-idle>")),
                                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                                "NO_LOCKS", storageManagerType),
                                        pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                                defaultBuiltInsType)
                                                .cast(builtInsType))
                                        .cast(moduleType))
                                .cast(notFoundClassesType),
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType),
                        pe.getField("org.jetbrains.kotlin.load.kotlin.PackagePartProvider$Empty",
                                "INSTANCE", packagePartProviderEmptyType)
                                .cast(packagePartProviderType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.java.components.FilesByFacadeFqNameIndexer.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.java.components.FilesByFacadeFqNameIndexer",
                        pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace",
                                pe.construct("com.intellij.mock.MockProject",
                                        pe.constantNull(picoType),
                                        pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                disposableType))
                                        .cast(projectType))
                                .cast(bindingTraceType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.jvm.JvmDiagnosticComponents.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.jvm.JvmDiagnosticComponents",
                        pe.construct("org.jetbrains.kotlin.load.java.AnnotationTypeQualifierResolver",
                                pe.invoke("org.jetbrains.kotlin.load.java.JavaTypeEnhancementState",
                                        "access$getDEFAULT$cp", javaTypeEnhancementStateType))
                                .cast(annotationTypeQualifierResolverType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.java.AnnotationTypeQualifierResolver.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.java.AnnotationTypeQualifierResolver",
                        pe.invoke("org.jetbrains.kotlin.load.java.JavaTypeEnhancementState",
                                "access$getDEFAULT$cp", javaTypeEnhancementStateType))
                        .cast(annotationTypeQualifierResolverType)
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.CompilerLocalDescriptorResolver.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.lazy.CompilerLocalDescriptorResolver",
                        pe.construct("org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver",
                                pe.construct("org.jetbrains.kotlin.context.GlobalContextImpl",
                                        pe.construct("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                                pe.constant("wasm-idle")),
                                        pe.construct("org.jetbrains.kotlin.storage.ExceptionTracker"))
                                        .cast(globalContextType),
                                pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace",
                                        pe.construct("com.intellij.mock.MockProject",
                                                pe.constantNull(picoType),
                                                pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                        disposableType))
                                                .cast(projectType))
                                        .cast(bindingTraceType),
                                pe.getField("org.jetbrains.kotlin.resolve.lazy.NoTopLevelDescriptorProvider",
                                        "INSTANCE", topLevelDescriptorProviderType),
                                pe.construct("org.jetbrains.kotlin.resolve.lazy.BasicAbsentDescriptorHandler")
                                        .cast(absentDescriptorHandlerType))
                                .cast(lazyDeclarationResolverType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.BasicAbsentDescriptorHandler.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.lazy.BasicAbsentDescriptorHandler")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.lazy.LazyDeclarationResolver",
                        pe.construct("org.jetbrains.kotlin.context.GlobalContextImpl",
                                pe.construct("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                        pe.constant("wasm-idle")),
                                pe.construct("org.jetbrains.kotlin.storage.ExceptionTracker"))
                                .cast(globalContextType),
                        pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace",
                                pe.construct("com.intellij.mock.MockProject",
                                        pe.constantNull(picoType),
                                        pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                disposableType))
                                        .cast(projectType))
                                .cast(bindingTraceType),
                        pe.getField("org.jetbrains.kotlin.resolve.lazy.NoTopLevelDescriptorProvider", "INSTANCE",
                                topLevelDescriptorProviderType),
                        pe.construct("org.jetbrains.kotlin.resolve.lazy.BasicAbsentDescriptorHandler")
                                .cast(absentDescriptorHandlerType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.idea.MainFunctionDetector.Factory.Ordinary.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.idea.MainFunctionDetector$Factory$Ordinary")
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.kotlin.DeserializationComponentsForJava.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.kotlin.DeserializationComponentsForJava",
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType),
                        pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                        pe.constant("<wasm-idle>")),
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                        defaultBuiltInsType)
                                        .cast(builtInsType))
                                .cast(moduleType),
                        pe.getField("org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration$Default",
                                "INSTANCE", deserializationConfigDefaultType)
                                .cast(deserializationConfigType),
                        pe.constantNull(javaClassDataFinderType),
                        pe.constantNull(binaryAnnotationLoaderType),
                        pe.constantNull(lazyJavaPackageProviderType),
                        pe.construct("org.jetbrains.kotlin.descriptors.NotFoundClasses",
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType),
                                pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                        pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                                pe.constant("<wasm-idle>")),
                                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                                "NO_LOCKS", storageManagerType),
                                        pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                                defaultBuiltInsType)
                                                .cast(builtInsType))
                                        .cast(moduleType))
                                .cast(notFoundClassesType),
                        pe.getField("org.jetbrains.kotlin.serialization.deserialization.ErrorReporter", "DO_NOTHING",
                                errorReporterType),
                        pe.getField("org.jetbrains.kotlin.incremental.components.LookupTracker$DO_NOTHING",
                                "INSTANCE", lookupTrackerDoNothingType)
                                .cast(lookupTrackerType),
                        pe.construct("org.jetbrains.kotlin.contracts.ContractDeserializerImpl",
                                pe.getField("org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration$Default",
                                        "INSTANCE", deserializationConfigDefaultType)
                                        .cast(deserializationConfigType),
                                pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                        storageManagerType))
                                .cast(contractDeserializerType),
                        pe.construct("org.jetbrains.kotlin.types.checker.NewKotlinTypeCheckerImpl",
                                pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default",
                                        "INSTANCE", refinerDefaultType)
                                        .cast(refinerType),
                                pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypePreparator$Default",
                                        "INSTANCE", preparatorDefaultType)
                                        .cast(preparatorType))
                                .cast(newCheckerType),
                        pe.construct("org.jetbrains.kotlin.types.extensions.TypeAttributeTranslators",
                                pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List")))
                                .cast(typeAttributeTranslatorsType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.java.components.SignaturePropagatorImpl.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.java.components.SignaturePropagatorImpl",
                        pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace",
                                pe.construct("com.intellij.mock.MockProject",
                                        pe.constantNull(picoType),
                                        pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                disposableType))
                                        .cast(projectType))
                                .cast(bindingTraceType))
                        .cast(signaturePropagatorType)
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.java.components.TraceBasedErrorReporter.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.java.components.TraceBasedErrorReporter",
                        pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace",
                                pe.construct("com.intellij.mock.MockProject",
                                        pe.constantNull(picoType),
                                        pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                disposableType))
                                        .cast(projectType))
                                .cast(bindingTraceType))
                        .cast(errorReporterType)
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.load.java.components.LazyResolveBasedCache.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.load.java.components.LazyResolveBasedCache",
                        pe.construct("org.jetbrains.kotlin.resolve.lazy.ResolveSession",
                                pe.construct("com.intellij.mock.MockProject",
                                        pe.constantNull(picoType),
                                        pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                disposableType))
                                        .cast(projectType),
                                pe.construct("org.jetbrains.kotlin.context.GlobalContextImpl",
                                        pe.construct("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                                pe.constant("wasm-idle")),
                                        pe.construct("org.jetbrains.kotlin.storage.ExceptionTracker"))
                                        .cast(globalContextType),
                                pe.construct("org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl",
                                        pe.invoke("org.jetbrains.kotlin.name.Name", "special", nameType,
                                                pe.constant("<wasm-idle>")),
                                        pe.construct("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                                pe.constant("wasm-idle"))
                                                .cast(storageManagerType),
                                        pe.invoke("org.jetbrains.kotlin.builtins.DefaultBuiltIns", "getInstance",
                                                defaultBuiltInsType)
                                                .cast(builtInsType))
                                        .cast(moduleType),
                                pe.construct("org.jetbrains.kotlin.resolve.lazy.declarations.FileBasedDeclarationProviderFactory",
                                        pe.construct("org.jetbrains.kotlin.storage.LockBasedStorageManager",
                                                pe.constant("wasm-idle"))
                                                .cast(storageManagerType),
                                        pe.invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                                                .cast(collectionType))
                                        .cast(declarationProviderFactoryType),
                                pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.NoScopeRecordCliBindingTrace",
                                        pe.construct("com.intellij.mock.MockProject",
                                                pe.constantNull(picoType),
                                                pe.invoke("com.intellij.openapi.util.Disposer", "newDisposable",
                                                        disposableType))
                                                .cast(projectType))
                                        .cast(bindingTraceType),
                                pe.construct("org.jetbrains.kotlin.types.checker.NewKotlinTypeCheckerImpl",
                                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeRefiner$Default",
                                                "INSTANCE", refinerDefaultType)
                                                .cast(refinerType),
                                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypePreparator$Default",
                                                "INSTANCE", preparatorDefaultType)
                                                .cast(preparatorType))
                                        .cast(newCheckerType))
                                .cast(resolveSessionType))
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.resolve.CompilerDeserializationConfiguration.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.resolve.CompilerDeserializationConfiguration",
                        pe.getField("org.jetbrains.kotlin.config.LanguageVersionSettingsImpl", "DEFAULT",
                                languageSettingsType)
                                .cast(languageSettingsInterfaceType))
                        .cast(compilerDeserializationConfigType)
                        .cast(objectType)
                        .returnValue());
        pe.when(pe.var(0, descriptorType).getField("klass", classType)
                .isSame(pe.constant(org.jetbrains.kotlin.contracts.ContractDeserializerImpl.class)
                        .cast(classType)))
                .thenDo(() -> pe.construct("org.jetbrains.kotlin.contracts.ContractDeserializerImpl",
                        pe.getField("org.jetbrains.kotlin.serialization.deserialization.DeserializationConfiguration$Default",
                                "INSTANCE", deserializationConfigDefaultType)
                                .cast(deserializationConfigType),
                        pe.getField("org.jetbrains.kotlin.storage.LockBasedStorageManager", "NO_LOCKS",
                                storageManagerType))
                        .cast(objectType)
                        .returnValue());
        pe.invoke("org.wasmidle.kotlin.teavm.SimpleKotlinContainer", "createSingleton", objectType,
                pe.var(0, descriptorType),
                pe.var(0, descriptorType).getField("klass", classType),
                pe.var(1, contextType))
                .returnValue();
    }

    private void transformCompileEnvironmentUtil(ClassHolder cls, ClassHolderTransformerContext context) {
        var clinit = getOrCreateStaticMethod(cls, "<clinit>", ValueType.VOID);
        var pe = ProgramEmitter.create(clinit, context.getHierarchy());
        if (cls.getField("DOS_EPOCH") != null) {
            pe.setField("org.jetbrains.kotlin.cli.jvm.compiler.CompileEnvironmentUtil",
                    "DOS_EPOCH", pe.constant(0L));
        }
        pe.exit();

        var jarOutputStreamType = ValueType.object("java.util.jar.JarOutputStream");
        replaceWithNoOp(cls, context, "writeToJar", ValueType.VOID,
                ValueType.object("java.io.File"), ValueType.BOOLEAN, ValueType.BOOLEAN, ValueType.BOOLEAN,
                ValueType.object("org.jetbrains.kotlin.name.FqName"),
                ValueType.object("org.jetbrains.kotlin.backend.common.output.OutputFileCollection"),
                ValueType.object("org.jetbrains.kotlin.cli.common.messages.MessageCollector"));
        replaceWithNoOp(cls, context, "doWriteToJar", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.backend.common.output.OutputFileCollection"),
                ValueType.object("java.io.OutputStream"), ValueType.object("org.jetbrains.kotlin.name.FqName"),
                ValueType.BOOLEAN, ValueType.BOOLEAN, ValueType.BOOLEAN);
        replaceWithNoOp(cls, context, "writeRuntimeToJar", ValueType.VOID,
                jarOutputStreamType, ValueType.BOOLEAN);
        replaceWithNoOp(cls, context, "writeReflectToJar", ValueType.VOID,
                jarOutputStreamType, ValueType.BOOLEAN);
        replaceWithNoOp(cls, context, "copyJarImpl", ValueType.VOID,
                jarOutputStreamType, ValueType.object("java.io.File"), ValueType.BOOLEAN);
    }

    private void transformJBZipFileWrapper(ClassHolder cls, ClassHolderTransformerContext context) {
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("java.io.File"), ValueType.VOID));
        if (constructor != null) {
            var wrapperType = ValueType.object("com.intellij.openapi.vfs.impl.JBZipFileWrapper");
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, wrapperType).invokeSpecial(Object.class, "<init>");
            pe.var(0, wrapperType)
                    .setField("myZipFile", pe.constantNull(ValueType.object("com.intellij.util.io.zip.JBZipFile")));
            pe.exit();
        }
        replaceWithNull(cls, context, "getEntry",
                ValueType.object("com.intellij.openapi.vfs.impl.GenericZipFile$GenericZipEntry"),
                ValueType.object("java.lang.String"));
        replaceWithEmptyList(cls, context, "getEntries");
        replaceWithNoOp(cls, context, "close", ValueType.VOID);
    }

    private void transformFastJarFileSystem(ClassHolder cls, ClassHolderTransformerContext context) {
        var functionType = ValueType.object("kotlin.jvm.functions.Function1");
        var constructor = cls.getMethod(new MethodDescriptor("<init>", functionType, ValueType.VOID));
        if (constructor != null) {
            var fileSystemType = ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.jarfs.FastJarFileSystem");
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, fileSystemType)
                    .invokeSpecial("com.intellij.openapi.vfs.DeprecatedVirtualFileSystem", "<init>");
            pe.var(0, fileSystemType).setField("unmapBuffer", pe.var(1, functionType));
            pe.var(0, fileSystemType)
                    .setField("myHandlers", pe.construct("java.util.HashMap").cast(ValueType.object("java.util.Map")));
            pe.var(0, fileSystemType)
                    .setField("cachedOpenFileHandles",
                            pe.constantNull(ValueType.object("com.intellij.util.io.FileAccessorCache")));
            pe.exit();
        }
        replaceWithNull(cls, context, "getCachedOpenFileHandles$cli_base",
                ValueType.object("com.intellij.util.io.FileAccessorCache"));
        replaceWithNull(cls, context, "findFileByPath",
                ValueType.object("com.intellij.openapi.vfs.VirtualFile"), ValueType.object("java.lang.String"));
        replaceWithNull(cls, context, "refreshAndFindFileByPath",
                ValueType.object("com.intellij.openapi.vfs.VirtualFile"), ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "clearHandlersCache", ValueType.VOID);
        replaceWithNoOp(cls, context, "cleanOpenFilesCache", ValueType.VOID);
    }

    private void transformFastJarHandler(ClassHolder cls, ClassHolderTransformerContext context) {
        var fileSystemType = ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.jarfs.FastJarFileSystem");
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                fileSystemType, ValueType.object("java.lang.String"), ValueType.VOID));
        if (constructor != null) {
            var handlerType = ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.jarfs.FastJarHandler");
            var virtualFileType = ValueType.object("com.intellij.openapi.vfs.VirtualFile");
            var jarVirtualFileType = ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.jarfs.FastJarVirtualFile");
            var zipEntryType = ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.jarfs.ZipEntryDescription");
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, handlerType).invokeSpecial(Object.class, "<init>");
            pe.var(0, handlerType).setField("fileSystem", pe.var(1, fileSystemType));
            pe.var(0, handlerType)
                    .setField("file", pe.construct("java.io.File", pe.var(2, ValueType.object("java.lang.String"))));
            pe.var(0, handlerType).setField("cachedManifest", pe.constructArray(ValueType.BYTE, 0));
            pe.var(0, handlerType)
                    .setField("myRoot", pe.construct("org.jetbrains.kotlin.cli.jvm.compiler.jarfs.FastJarVirtualFile",
                            pe.var(0, handlerType), pe.constant("").cast(ValueType.object("java.lang.CharSequence")),
                            pe.constant(-1L), pe.constantNull(jarVirtualFileType), pe.constantNull(zipEntryType))
                            .cast(virtualFileType));
            pe.exit();
        }
        replaceWithNull(cls, context, "findFileByPath",
                ValueType.object("com.intellij.openapi.vfs.VirtualFile"), ValueType.object("java.lang.String"));
        replaceWithEmptyByteArray(cls, context, "contentsToByteArray",
                ValueType.object("org.jetbrains.kotlin.cli.jvm.compiler.jarfs.ZipEntryDescription"));
    }

    private void transformPerformanceManager(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithZeroTime(cls, context, "currentTime");
        replaceWithNoOp(cls, context, "initializeCurrentThread", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyCompilationFinished", ValueType.VOID);
        replaceWithNoOp(cls, context, "notifyCurrentPhaseFinishedIfNeeded", ValueType.VOID);
        replaceWithNoOp(cls, context, "enableExtendedStats", ValueType.VOID);
        replaceWithNoOp(cls, context, "dumpPerformanceReport", ValueType.VOID,
                ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "notifyDynamicPhaseStarted", ValueType.VOID,
                ValueType.object("java.lang.String"));
        replaceWithNoOp(cls, context, "notifyDynamicPhaseFinished", ValueType.VOID,
                ValueType.object("java.lang.String"), ValueType.object("org.jetbrains.kotlin.util.PhaseType"));
        replaceWithNoOp(cls, context, "notifyPhaseStarted", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.util.PhaseType"));
        replaceWithNoOp(cls, context, "notifyPhaseFinished", ValueType.VOID,
                ValueType.object("org.jetbrains.kotlin.util.PhaseType"));
        replaceWithConstantString(cls, context, "createPerformanceReport",
                ValueType.object("org.jetbrains.kotlin.util.PerformanceManager$DumpFormat"));
        replaceMeasureSideTime(cls, context);
    }

    private void transformLowMemoryWatcherManager(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithConstantLong(cls, context, "getMajorGcTime", 0);
        replaceWithCompletedFuture(cls, context, "initializeMXBeanListenersLater",
                ValueType.object("java.util.concurrent.ExecutorService"));
        replaceWithConstantFloat(cls, context, "getOccupiedMemoryThreshold", 1);
        replaceWithConstantLong(cls, context, "access$600", 0);
    }

    private void transformAppDelayQueue(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "remove", ValueType.BOOLEAN, ValueType.object("java.lang.Object"));
        ProgramEmitter.create(method, context.getHierarchy()).constant(0).returnValue();

        method = getOrCreateMethod(cls, "peek", ValueType.object("java.util.concurrent.Delayed"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.util.concurrent.Delayed"))
                .returnValue();

        method = getOrCreateMethod(cls, "add", ValueType.BOOLEAN, ValueType.object("java.util.concurrent.Delayed"));
        ProgramEmitter.create(method, context.getHierarchy()).constant(1).returnValue();
    }

    private void transformAppDelayQueueTransferThread(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "run", ValueType.VOID);
    }

    private void transformSchedulingWrapperShutdownTask(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithConstantBoolean(cls, context, "executeMeInBackendExecutor", false);
    }

    private void transformScheduledFutureTask(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNoOp(cls, context, "run", ValueType.VOID);
        replaceWithNoOp(cls, context, "setNextRunTime", ValueType.VOID);
        replaceWithConstantBoolean(cls, context, "executeMeInBackendExecutor", false);
        replaceWithConstantLong(cls, context, "getDelay", 0, ValueType.object("java.util.concurrent.TimeUnit"));
    }

    private void transformAppScheduledExecutorService(ClassHolder cls, ClassHolderTransformerContext context) {
        var serviceType = ValueType.object("com.intellij.util.concurrency.AppScheduledExecutorService");
        var executorServiceType = ValueType.object("java.util.concurrent.ExecutorService");
        var constructor = cls.getMethod(new MethodDescriptor("<init>",
                ValueType.object("java.lang.String"), ValueType.LONG,
                ValueType.object("java.util.concurrent.TimeUnit"), ValueType.VOID));
        if (constructor != null) {
            var pe = ProgramEmitter.create(constructor, context.getHierarchy());
            pe.var(0, serviceType).invokeSpecial("com.intellij.util.concurrency.SchedulingWrapper", "<init>",
                    pe.invoke("java.util.concurrent.Executors", "newSingleThreadExecutor", executorServiceType),
                    pe.construct("com.intellij.util.concurrency.AppDelayQueue"));
            pe.var(0, serviceType).setField("myName", pe.var(1, ValueType.object("java.lang.String")));
            pe.var(0, serviceType).setField("myLowMemoryWatcherManager",
                    pe.constantNull(ValueType.object("com.intellij.openapi.util.LowMemoryWatcherManager")));
            pe.exit();
        }

        replaceWithEmptyList(cls, context, "shutdownNow");
        replaceWithNoOp(cls, context, "shutdown", ValueType.VOID);
        replaceWithEmptyList(cls, context, "notAllowedMethodCall");
        replaceWithNoOp(cls, context, "onDelayQueuePurgedOnShutdown", ValueType.VOID);
        replaceWithConstantBoolean(cls, context, "awaitTermination", true,
                ValueType.LONG, ValueType.object("java.util.concurrent.TimeUnit"));
        replaceWithNull(cls, context, "capturePropagationAndCancellationContext",
                ValueType.object("java.lang.Runnable"), ValueType.object("java.lang.Runnable"));
        replaceWithNull(cls, context, "capturePropagationAndCancellationContext",
                ValueType.object("java.util.concurrent.FutureTask"), ValueType.object("java.util.concurrent.Callable"));
    }

    private void transformThreadContext(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithEmptyCoroutineContext(cls, context, "currentThreadContextOrNull");
        replaceWithEmptyCoroutineContext(cls, context, "currentThreadContext");
        replaceWithNoOp(cls, context, "checkContextInstalled", ValueType.VOID);
        replaceWithEmptyAccessToken(cls, context, "resetThreadContext");
        replaceWithEmptyAccessToken(cls, context, "installThreadContext",
                ValueType.object("kotlin.coroutines.CoroutineContext"), ValueType.BOOLEAN);
        replaceWithReturnedArgument(cls, context, "captureThreadContext", ValueType.object("java.lang.Runnable"), 0,
                ValueType.object("java.lang.Runnable"));
    }

    private void transformClientIdKt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNull(cls, context, "getClientIdContextElement",
                ValueType.object("com.intellij.codeWithMe.ClientIdContextElement"),
                ValueType.object("kotlin.coroutines.CoroutineContext"));
        replaceWithNull(cls, context, "getCurrentThreadClientId",
                ValueType.object("com.intellij.codeWithMe.ClientId"));
    }

    private static void replaceWithNoOp(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType returnType, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).exit();
    }

    private static void replaceWithConstantString(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name,
                appendReturnType(ValueType.object("java.lang.String"), argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).constant("").returnValue();
    }

    private static void replaceWithNull(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType returnType, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(returnType).returnValue();
    }

    private static void replaceWithConstantBoolean(ClassHolder cls, ClassHolderTransformerContext context, String name,
            boolean value, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(ValueType.BOOLEAN, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).constant(value ? 1 : 0).returnValue();
    }

    private static void replaceWithConstantInt(ClassHolder cls, ClassHolderTransformerContext context, String name,
            int value, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(ValueType.INTEGER, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).constant(value).returnValue();
    }

    private static void replaceWithConstantLong(ClassHolder cls, ClassHolderTransformerContext context, String name,
            long value, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(ValueType.LONG, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).constant(value).returnValue();
    }

    private static void replaceWithConstantFloat(ClassHolder cls, ClassHolderTransformerContext context, String name,
            float value, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(ValueType.FLOAT, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).constant(value).returnValue();
    }

    private static void replaceWithFile(ClassHolder cls, ClassHolderTransformerContext context, String name,
            String path, ValueType... argumentTypes) {
        var returnType = ValueType.object("java.io.File");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct("java.io.File", pe.constant(path)).returnValue();
    }

    private static void replaceWithReturnedArgument(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType returnType, int argumentIndex, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).var(argumentIndex, returnType).returnValue();
    }

    private static void replaceWithCompletedFuture(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.object("java.util.concurrent.Future");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("java.util.concurrent.CompletableFuture", "completedFuture",
                ValueType.object("java.util.concurrent.CompletableFuture"),
                pe.constantNull(ValueType.object("java.lang.Object")))
                .cast(returnType)
                .returnValue();
    }

    private static void replaceWithZeroTime(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.object("org.jetbrains.kotlin.util.Time");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct("org.jetbrains.kotlin.util.Time", pe.constant(0L), pe.constant(0L), pe.constant(0L))
                .returnValue();
    }

    private static void replaceWithEmptyCoroutineContext(ClassHolder cls, ClassHolderTransformerContext context,
            String name, ValueType... argumentTypes) {
        var returnType = ValueType.object("kotlin.coroutines.CoroutineContext");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .getField("kotlin.coroutines.EmptyCoroutineContext", "INSTANCE",
                        ValueType.object("kotlin.coroutines.EmptyCoroutineContext"))
                .cast(returnType)
                .returnValue();
    }

    private static void replaceWithEmptyAccessToken(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.object("com.intellij.openapi.application.AccessToken");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .getField("com.intellij.openapi.application.AccessToken", "EMPTY_ACCESS_TOKEN", returnType)
                .returnValue();
    }

    private static void replaceWithEmptyObjectArray(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.arrayOf(ValueType.object("java.lang.Object"));
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.Object"), 0)
                .returnValue();
    }

    private static void replaceWithEmptyFormatArray(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.arrayOf(ValueType.object("java.text.Format"));
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .constructArray(ValueType.object("java.text.Format"), 0)
                .returnValue();
    }

    private static void replaceWithEmptyIntArray(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.arrayOf(ValueType.INTEGER);
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .constructArray(ValueType.INTEGER, 0)
                .returnValue();
    }

    private static void replaceWithRootLocale(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.object("java.util.Locale");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .getField("java.util.Locale", "ROOT", returnType)
                .returnValue();
    }

    private static void replaceWithOverrideCompatibilitySuccess(ClassHolder cls,
            ClassHolderTransformerContext context, String name, ValueType... argumentTypes) {
        var returnType = ValueType.object("org.jetbrains.kotlin.resolve.OverridingUtil$OverrideCompatibilityInfo");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke("org.jetbrains.kotlin.resolve.OverridingUtil$OverrideCompatibilityInfo",
                        "success", returnType)
                .returnValue();
    }

    private static void createNoOpFieldSetter(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType valueType) {
        var method = getOrCreateMethod(cls, name, ValueType.VOID,
                ValueType.object("java.lang.Object"), valueType);
        ProgramEmitter.create(method, context.getHierarchy()).exit();
    }

    private static void replaceWithEmptyList(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        replaceWithStaticFactory(cls, context, name, ValueType.object("java.util.List"),
                "java.util.Collections", "emptyList", argumentTypes);
    }

    private static void replaceWithEmptySet(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        replaceWithStaticFactory(cls, context, name, ValueType.object("java.util.Set"),
                "java.util.Collections", "emptySet", argumentTypes);
    }

    private static void replaceWithEmptyCollection(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.object("java.util.Collection");
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke("java.util.Collections", "emptyList", ValueType.object("java.util.List"))
                .cast(returnType)
                .returnValue();
    }

    private static void replaceWithEmptyEnumeration(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        replaceWithStaticFactory(cls, context, name, ValueType.object("java.util.Enumeration"),
                "java.util.Collections", "emptyEnumeration", argumentTypes);
    }

    private static void replaceWithEmptyByteArray(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.arrayOf(ValueType.BYTE);
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy()).constructArray(ValueType.BYTE, 0).returnValue();
    }

    private static void replaceWithEmptyTypeArray(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var returnType = ValueType.arrayOf(ValueType.object("java.lang.reflect.Type"));
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.reflect.Type"), 0)
                .returnValue();
    }

    private static void createNullMethod(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType returnType, ValueType... argumentTypes) {
        var method = getOrCreateMethod(cls, name, returnType, argumentTypes);
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(returnType).returnValue();
    }

    private static void createConstantStringMethod(ClassHolder cls, ClassHolderTransformerContext context, String name,
            String value, ValueType... argumentTypes) {
        var returnType = ValueType.object("java.lang.String");
        var method = getOrCreateStaticMethod(cls, name, returnType, argumentTypes);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        if (value == null) {
            pe.constantNull(returnType).returnValue();
        } else {
            pe.constant(value).returnValue();
        }
    }

    private static void createConstantStringInstanceMethod(ClassHolder cls, ClassHolderTransformerContext context,
            String name, String value, ValueType... argumentTypes) {
        var returnType = ValueType.object("java.lang.String");
        var method = getOrCreateMethod(cls, name, returnType, argumentTypes);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        if (value == null) {
            pe.constantNull(returnType).returnValue();
        } else {
            pe.constant(value).returnValue();
        }
    }

    private static void createEmptyStringArrayMethod(ClassHolder cls, ClassHolderTransformerContext context,
            String name, ValueType... argumentTypes) {
        var returnType = ValueType.arrayOf(ValueType.object("java.lang.String"));
        var method = getOrCreateStaticMethod(cls, name, returnType, argumentTypes);
        ProgramEmitter.create(method, context.getHierarchy())
                .constructArray(ValueType.object("java.lang.String"), 0)
                .returnValue();
    }

    private static void replaceWithStaticFactory(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType returnType, String owner, String factoryName, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        ProgramEmitter.create(method, context.getHierarchy())
                .invoke(owner, factoryName, returnType)
                .returnValue();
    }

    private static MethodHolder getOrCreateMethod(ClassHolder cls, String name, ValueType returnType,
            ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            method = new MethodHolder(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
            method.setLevel(AccessLevel.PUBLIC);
            cls.addMethod(method);
        }
        prepareMethodBody(method);
        return method;
    }

    private static MethodHolder getOrCreateStaticMethod(ClassHolder cls, String name, ValueType returnType,
            ValueType... argumentTypes) {
        var method = getOrCreateMethod(cls, name, returnType, argumentTypes);
        method.getModifiers().add(ElementModifier.STATIC);
        return method;
    }

    private static void replaceMeasureSideTime(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("measureSideTime$compiler_common",
                ValueType.object("org.jetbrains.kotlin.util.PhaseSideType"),
                ValueType.object("kotlin.jvm.functions.Function0"), ValueType.object("java.lang.Object")));
        if (method == null) {
            return;
        }
        prepareMethodBody(method);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.var(2, ValueType.object("kotlin.jvm.functions.Function0"))
                .invokeVirtual("invoke", ValueType.object("java.lang.Object"))
                .returnValue();
    }

    private static void prepareMethodBody(MethodHolder method) {
        method.getModifiers().remove(ElementModifier.NATIVE);
        method.getModifiers().remove(ElementModifier.ABSTRACT);
    }

    private static ValueType[] appendReturnType(ValueType returnType, ValueType[] argumentTypes) {
        var result = new ValueType[argumentTypes.length + 1];
        System.arraycopy(argumentTypes, 0, result, 0, argumentTypes.length);
        result[argumentTypes.length] = returnType;
        return result;
    }
}
