/* Browser platform hooks adapted from konsoletyper/teavm-javac Patches.java,
 * Copyright 2025 Alexey Andreev, Apache License 2.0. */
package org.wasmidle.javacs;

import org.teavm.model.*;
import org.teavm.model.emit.ProgramEmitter;
import org.teavm.model.instructions.InvokeInstruction;
import org.teavm.vm.spi.TeaVMHost;
import org.teavm.vm.spi.TeaVMPlugin;

/** No compiler parser, resolver, type checker or language-server handler is replaced. */
public final class CompilerPlatform implements TeaVMPlugin, ClassHolderTransformer {
    public void install(TeaVMHost host) { host.add(this); }

    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        var name = cls.getName();
        if (name.equals("java.io.File")) {
            var method = new MethodHolder(new MethodDescriptor("toPath", ValueType.object("java.nio.file.Path")));
            cls.addMethod(method);
            var pe = ProgramEmitter.create(method, context.getHierarchy());
            pe.invoke(BrowserPlatformIO.class, "toPath", java.nio.file.Path.class, pe.var(0, java.io.File.class)).returnValue();
        }
        if (name.equals("java.io.Reader")) {
            var method = new MethodHolder(new MethodDescriptor("transferTo", ValueType.object("java.io.Writer"), ValueType.LONG));
            cls.addMethod(method);
            var pe = ProgramEmitter.create(method, context.getHierarchy());
            pe.invoke(BrowserPlatformIO.class, "transferTo", long.class,
                    pe.var(0, java.io.Reader.class), pe.var(1, java.io.Writer.class)).returnValue();
        }
        if (name.equals("java.lang.System")) {
            var method = new MethodHolder(new MethodDescriptor("exit", ValueType.INTEGER, ValueType.VOID));
            method.getModifiers().add(ElementModifier.STATIC);
            cls.addMethod(method);
            ProgramEmitter.create(method, context.getHierarchy()).construct(IllegalStateException.class).raise();
        }
        for (var method : cls.getMethods()) {
            var descriptor = method.getDescriptor();
            var methodName = descriptor.getName();
            if (name.equals("java.nio.file.Path") && descriptor.equals(new MethodDescriptor("of",
                    ValueType.object("java.net.URI"), ValueType.object("java.nio.file.Path")))) {
                var pe = ProgramEmitter.create(method, context.getHierarchy());
                pe.invoke(BrowserPlatformIO.class, "pathOf", java.nio.file.Path.class,
                        pe.var(1, java.net.URI.class)).returnValue();
            }
            if (name.equals("java.nio.file.impl.DefaultPath") && descriptor.equals(new MethodDescriptor("toUri",
                    ValueType.object("java.net.URI")))) {
                var pe = ProgramEmitter.create(method, context.getHierarchy());
                pe.invoke(BrowserPlatformIO.class, "toUri", java.net.URI.class,
                        pe.var(0, java.nio.file.Path.class)).returnValue();
            }
            if ((name.equals("com.sun.tools.javac.api.BasicJavacTask")
                        && (methodName.equals("initPlugins") || methodName.equals("initDocLint")))
                    || (name.equals("com.sun.tools.javac.main.JavaCompiler") && methodName.equals("initProcessAnnotations"))
                    || (name.equals("com.sun.tools.javac.file.BaseFileManager") && methodName.equals("deferredClose"))) {
                ProgramEmitter.create(method, context.getHierarchy()).exit();
            }
            if (name.equals("com.sun.tools.javac.model.AnnotationProxyMaker") && methodName.equals("generateAnnotation")) {
                ProgramEmitter.create(method, context.getHierarchy()).construct(UnsupportedOperationException.class).raise();
            }
            if (name.equals("com.sun.tools.javac.api.JavacTool") && methodName.equals("getStandardFileManager")) {
                var pe = ProgramEmitter.create(method, context.getHierarchy());
                if (descriptor.getResultType().equals(ValueType.object("javax.tools.StandardJavaFileManager"))) {
                    pe.invoke("org.javacs.BrowserFileManager", "create", ValueType.object("javax.tools.StandardJavaFileManager")).returnValue();
                } else {
                    // The covariant concrete JavacFileManager return type cannot hold our adapter.
                    // The browser SourceFileManager always supplies its delegate explicitly.
                    pe.construct(UnsupportedOperationException.class).raise();
                }
            }
            if ((name.equals("com.sun.tools.javac.main.Option$2") || name.equals("com.sun.tools.javac.main.Option$3"))
                    && methodName.equals("matches")) {
                ProgramEmitter.create(method, context.getHierarchy()).constant(0).returnValue();
            }
            if ((name.equals("com.sun.tools.javac.main.Option") && methodName.equals("showHelp"))
                    || ((name.equals("com.sun.tools.javac.main.Option$36") || name.equals("com.sun.tools.javac.main.Option$39"))
                        && methodName.equals("process"))) {
                ProgramEmitter.create(method, context.getHierarchy()).construct(UnsupportedOperationException.class).raise();
            }
            if (name.equals("com.sun.tools.javac.main.JavaCompiler") && methodName.equals("<init>")
                    && method.getProgram() != null) {
                for (var block : method.getProgram().getBasicBlocks()) {
                    for (var instruction : block) {
                        if (instruction instanceof InvokeInstruction) {
                            var invoke = (InvokeInstruction) instruction;
                            if (invoke.getMethod().getClassName().equals("com.sun.tools.javac.file.JavacFileManager")
                                    && invoke.getMethod().getName().equals("preRegister")) invoke.delete();
                        }
                    }
                }
            }
        }
    }
}
