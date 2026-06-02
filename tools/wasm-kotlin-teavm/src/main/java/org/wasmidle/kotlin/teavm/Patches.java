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
        switch (cls.getName()) {
            case "java.lang.Class":
                transformLangClass(cls, context);
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
            case "org.jetbrains.kotlin.diagnostics.Errors$Initializer":
                transformErrorsInitializer(cls, context);
                break;
            case "org.jetbrains.kotlin.resolve.jvm.checkers.WarningAwareUpperBoundChecker":
                transformWarningAwareUpperBoundChecker(cls, context);
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
                    pe.invoke("org.jetbrains.kotlin.cli.CliDiagnosticsKt",
                            "initializeDiagnosticFactoriesStorageForCli", ValueType.VOID,
                            pe.var(2, compilerConfigurationType));
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
            case "org.jetbrains.kotlin.KotlinElementTypeProvider$Companion":
                transformKotlinElementTypeProviderCompanion(cls, context);
                break;
            case "org.jetbrains.kotlin.config.KotlinCompilerVersion": {
                var owner = "org.jetbrains.kotlin.config.KotlinCompilerVersion";
                var clinit = getOrCreateStaticMethod(cls, "<clinit>", ValueType.VOID);
                var pe = ProgramEmitter.create(clinit, context.getHierarchy());
                pe.setField(owner, "VERSION", pe.constant("2.3.21"));
                pe.setField(owner, "IS_PRE_RELEASE", pe.constant(0));
                pe.exit();

                var getVersion = getOrCreateStaticMethod(cls, "getVersion", ValueType.object("java.lang.String"));
                ProgramEmitter.create(getVersion, context.getHierarchy())
                        .constant("2.3.21")
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

    private static void addAbstractMethod(ClassHolder cls, String name, ValueType returnType,
            ValueType... argumentTypes) {
        var method = new MethodHolder(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        method.setLevel(AccessLevel.PUBLIC);
        method.getModifiers().add(ElementModifier.ABSTRACT);
        cls.addMethod(method);
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

        var classArrayType = ValueType.arrayOf(ValueType.object("java.lang.Class"));
        var declaredMethod = getOrCreateMethod(cls, "getDeclaredMethod",
                ValueType.object("java.lang.reflect.Method"),
                ValueType.object("java.lang.String"), classArrayType);
        ProgramEmitter.create(declaredMethod, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.reflect.Method"))
                .returnValue();

        var constructor = getOrCreateMethod(cls, "getConstructor", ValueType.object("java.lang.reflect.Constructor"),
                classArrayType);
        ProgramEmitter.create(constructor, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.reflect.Constructor"))
                .returnValue();

        var newInstance = getOrCreateMethod(cls, "newInstance", ValueType.object("java.lang.Object"));
        ProgramEmitter.create(newInstance, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.Object"))
                .returnValue();
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
    }

    private void transformFile(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "toPath", ValueType.object("java.nio.file.Path"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.nio.file.Path"))
                .returnValue();
    }

    private void transformLong(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateStaticMethod(cls, "parseUnsignedLong", ValueType.LONG,
                ValueType.object("java.lang.String"), ValueType.INTEGER);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("java.lang.Long", "parseLong", ValueType.LONG,
                pe.var(1, ValueType.object("java.lang.String")), pe.var(2, ValueType.INTEGER))
                .returnValue();
    }

    private void transformLocale(ClassHolder cls, ClassHolderTransformerContext context) {
        var localeType = ValueType.object("java.util.Locale");
        var method = getOrCreateStaticMethod(cls, "forLanguageTag", localeType,
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .getField("java.util.Locale", "ROOT", localeType)
                .returnValue();
    }

    private void transformRuntime(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "addShutdownHook", ValueType.VOID,
                ValueType.object("java.lang.Thread"));
        ProgramEmitter.create(method, context.getHierarchy()).exit();
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

        replaceWithNoOp(cls, context, "arraycopy", ValueType.VOID,
                ValueType.object("java.lang.Object"), ValueType.INTEGER, ValueType.object("java.lang.Object"),
                ValueType.INTEGER, ValueType.INTEGER);
        replaceWithNoOp(cls, context, "arrayCopyImpl", ValueType.VOID,
                ValueType.object("java.lang.Object"), ValueType.INTEGER, ValueType.object("java.lang.Object"),
                ValueType.INTEGER, ValueType.INTEGER);
    }

    private void transformMethodHandles(ClassHolder cls, ClassHolderTransformerContext context) {
        var lookupType = ValueType.object("java.lang.invoke.MethodHandles$Lookup");
        var method = getOrCreateStaticMethod(cls, "lookup", lookupType);
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

        method = getOrCreateMethod(cls, "invokeExact", objectType);
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(objectType).returnValue();

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
                ValueType.object("java.lang.Class"), ValueType.object("java.util.List"));
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(methodType).returnValue();

        method = getOrCreateMethod(cls, "parameterType", ValueType.object("java.lang.Class"), ValueType.INTEGER);
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.lang.Class"))
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
                ValueType.object("java.util.concurrent.ConcurrentHashMap$KeySetView"),
                ValueType.object("java.lang.Object"));
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("java.util.concurrent.ConcurrentHashMap$KeySetView")
                .returnValue();
    }

    private void transformContainerUtil(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("newConcurrentSet", ValueType.object("java.util.Set")));
        if (method == null) {
            return;
        }
        ProgramEmitter.create(method, context.getHierarchy())
                .construct("java.util.HashSet")
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
        pe.setField(owner, "isJBSystemMenu", pe.constant(0));
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
            pe.var(0, appInfoType)
                    .setField("essentialPluginIds",
                            pe.construct("java.util.ArrayList").cast(ValueType.object("java.util.List")));
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
        replaceWithConstantBoolean(cls, context, "isInNonCancelableSection", false);
        replaceWithConstantBoolean(cls, context, "isInNonCancelableSectionInternal", false);
    }

    private void transformEdt(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithNull(cls, context, "getEventDispatchThreadOrNull",
                ValueType.object("java.lang.Thread"));
        replaceWithConstantBoolean(cls, context, "isCurrentThreadEdt", true);
    }

    private void transformThreadDumper(ClassHolder cls, ClassHolderTransformerContext context) {
        replaceWithConstantString(cls, context, "dumpThreadsToString");
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
            pe.var(0, managerType).setField("virtualFileManagerListeners", pe.construct("java.util.ArrayList"));
            pe.var(0, managerType).setField("asyncFileListeners", pe.construct("java.util.ArrayList"));
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

    private void transformWarningAwareUpperBoundChecker(ClassHolder cls, ClassHolderTransformerContext context) {
        var checkerType = ValueType.object("org.jetbrains.kotlin.types.checker.KotlinTypeChecker");
        var typedConstructor = cls.getMethod(new MethodDescriptor("<init>", checkerType, ValueType.VOID));
        if (typedConstructor != null) {
            typedConstructor.setLevel(AccessLevel.PRIVATE);
        }

        var checkerClass = "org.jetbrains.kotlin.resolve.jvm.checkers.WarningAwareUpperBoundChecker";
        var checkerObjectType = ValueType.object(checkerClass);
        var constructor = cls.getMethod(new MethodDescriptor("<init>", ValueType.VOID));
        if (constructor == null) {
            constructor = new MethodHolder(new MethodDescriptor("<init>", ValueType.VOID));
            cls.addMethod(constructor);
        }
        constructor.setLevel(AccessLevel.PUBLIC);
        prepareMethodBody(constructor);
        var pe = ProgramEmitter.create(constructor, context.getHierarchy());
        pe.var(0, checkerObjectType)
                .invokeSpecial("<init>", ValueType.VOID,
                        pe.getField("org.jetbrains.kotlin.types.checker.KotlinTypeChecker", "DEFAULT", checkerType));
        pe.exit();
    }

    private void transformCompileEnvironmentUtil(ClassHolder cls, ClassHolderTransformerContext context) {
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
