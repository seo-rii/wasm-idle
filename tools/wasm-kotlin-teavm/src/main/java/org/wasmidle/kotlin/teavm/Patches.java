package org.wasmidle.kotlin.teavm;

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
    @Override
    public void install(TeaVMHost host) {
        host.add(this);
    }

    @Override
    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        switch (cls.getName()) {
            case "java.lang.Class":
                transformLangClass(cls, context);
                break;
            case "java.lang.ClassLoader":
                transformClassLoader(cls, context);
                break;
            case "java.lang.Long":
                transformLong(cls, context);
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
            case "java.lang.reflect.Field":
                transformReflectField(cls, context);
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
            case "java.util.stream.StreamSupport":
                transformStreamSupport(cls, context);
                break;
            case "com.intellij.util.containers.ContainerUtil":
                transformContainerUtil(cls, context);
                break;
            case "com.intellij.util.lang.UrlClassLoader":
                transformUrlClassLoader(cls, context);
                break;
            case "com.intellij.mock.MockApplication":
                transformMockApplication(cls, context);
                break;
            case "org.jetbrains.kotlin.cli.common.CLICompiler":
                transformCliCompiler(cls, context);
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
    }

    private void transformClassLoader(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "getSystemResource", ValueType.object("java.net.URL"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .constantNull(ValueType.object("java.net.URL"))
                .returnValue();
    }

    private void transformLong(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "parseUnsignedLong", ValueType.LONG,
                ValueType.object("java.lang.String"), ValueType.INTEGER);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("java.lang.Long", "parseLong", ValueType.LONG,
                pe.var(1, ValueType.object("java.lang.String")), pe.var(2, ValueType.INTEGER))
                .returnValue();
    }

    private void transformRuntime(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "addShutdownHook", ValueType.VOID,
                ValueType.object("java.lang.Thread"));
        ProgramEmitter.create(method, context.getHierarchy()).exit();
    }

    private void transformSystem(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("exit", ValueType.INTEGER, ValueType.VOID));
        if (method == null) {
            method = new MethodHolder(new MethodDescriptor("exit", ValueType.INTEGER, ValueType.VOID));
            cls.addMethod(method);
        }
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct(IllegalStateException.class, pe.constant("System.exit is not available in wasm-idle"))
                .raise();

        method = getOrCreateMethod(cls, "mapLibraryName", ValueType.object("java.lang.String"),
                ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy())
                .var(1, ValueType.object("java.lang.String"))
                .returnValue();
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

    private void transformReflectType(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = getOrCreateMethod(cls, "getTypeName", ValueType.object("java.lang.String"));
        ProgramEmitter.create(method, context.getHierarchy()).constant("").returnValue();
    }

    private void transformArrays(ClassHolder cls, ClassHolderTransformerContext context) {
        var arrayType = ValueType.arrayOf(ValueType.object("java.lang.Object"));
        var spliteratorType = ValueType.object("java.util.Spliterator");
        var method = getOrCreateStaticMethod(cls, "spliterator", spliteratorType, arrayType);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.invoke("java.util.Spliterators", "spliterator", spliteratorType,
                pe.var(0, arrayType), pe.constant(0x410))
                .returnValue();
    }

    private void transformSpliterators(ClassHolder cls, ClassHolderTransformerContext context) {
        var spliteratorType = ValueType.object("java.util.Spliterator");
        var iteratorType = ValueType.object("java.util.Iterator");
        var method = getOrCreateStaticMethod(cls, "iterator", iteratorType, spliteratorType);
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct("org.wasmidle.kotlin.teavm.SpliteratorIterator", pe.var(0, spliteratorType))
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
        var method = getOrCreateMethod(cls, "registerAsParallelCapable", ValueType.BOOLEAN);
        ProgramEmitter.create(method, context.getHierarchy()).constant(1).returnValue();
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

    private void transformPerformanceManager(ClassHolder cls, ClassHolderTransformerContext context) {
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

    private static void replaceWithNoOp(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType returnType, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        ProgramEmitter.create(method, context.getHierarchy()).exit();
    }

    private static void replaceWithConstantString(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name,
                appendReturnType(ValueType.object("java.lang.String"), argumentTypes)));
        if (method == null) {
            return;
        }
        ProgramEmitter.create(method, context.getHierarchy()).constant("").returnValue();
    }

    private static void replaceWithNull(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType returnType, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
        ProgramEmitter.create(method, context.getHierarchy()).constantNull(returnType).returnValue();
    }

    private static void replaceWithConstantBoolean(ClassHolder cls, ClassHolderTransformerContext context, String name,
            boolean value, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(ValueType.BOOLEAN, argumentTypes)));
        if (method == null) {
            return;
        }
        ProgramEmitter.create(method, context.getHierarchy()).constant(value ? 1 : 0).returnValue();
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

    private static void replaceWithStaticFactory(ClassHolder cls, ClassHolderTransformerContext context, String name,
            ValueType returnType, String owner, String factoryName, ValueType... argumentTypes) {
        var method = cls.getMethod(new MethodDescriptor(name, appendReturnType(returnType, argumentTypes)));
        if (method == null) {
            return;
        }
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
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.var(2, ValueType.object("kotlin.jvm.functions.Function0"))
                .invokeVirtual("invoke", ValueType.object("java.lang.Object"))
                .returnValue();
    }

    private static ValueType[] appendReturnType(ValueType returnType, ValueType[] argumentTypes) {
        var result = new ValueType[argumentTypes.length + 1];
        System.arraycopy(argumentTypes, 0, result, 0, argumentTypes.length);
        result[argumentTypes.length] = returnType;
        return result;
    }
}
