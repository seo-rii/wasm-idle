package org.wasmidle.kotlin.teavm;

import org.teavm.model.AccessLevel;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
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
            case "java.lang.System":
                transformSystem(cls, context);
                break;
            case "java.lang.reflect.Field":
                transformReflectField(cls, context);
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

    private void transformSystem(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("exit", ValueType.INTEGER, ValueType.VOID));
        if (method == null) {
            method = new MethodHolder(new MethodDescriptor("exit", ValueType.INTEGER, ValueType.VOID));
            cls.addMethod(method);
        }
        var pe = ProgramEmitter.create(method, context.getHierarchy());
        pe.construct(IllegalStateException.class, pe.constant("System.exit is not available in wasm-idle"))
                .raise();
    }

    private void transformReflectField(ClassHolder cls, ClassHolderTransformerContext context) {
        var method = cls.getMethod(new MethodDescriptor("setInt",
                ValueType.object("java.lang.Object"), ValueType.INTEGER, ValueType.VOID));
        if (method == null) {
            method = new MethodHolder(new MethodDescriptor("setInt",
                    ValueType.object("java.lang.Object"), ValueType.INTEGER, ValueType.VOID));
            method.setLevel(AccessLevel.PUBLIC);
            cls.addMethod(method);
        }
        ProgramEmitter.create(method, context.getHierarchy()).exit();
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
