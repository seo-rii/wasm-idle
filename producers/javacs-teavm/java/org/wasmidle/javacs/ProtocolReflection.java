package org.wasmidle.javacs;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.teavm.classlib.ReflectionContext;
import org.teavm.classlib.ReflectionSupplier;
import org.teavm.model.MethodDescriptor;
import org.teavm.model.ValueType;

/** Retain the upstream compiler's reflective hooks; DTO mapping uses build-time metadata. */
public final class ProtocolReflection implements ReflectionSupplier {
    @Override
    public Collection<String> getAccessibleFields(ReflectionContext context, String name) {
        return List.of();
    }

    @Override
    public Collection<MethodDescriptor> getAccessibleMethods(ReflectionContext context, String name) {
        if (!name.equals("com.sun.tools.javac.api.JavacTaskImpl")
                && !name.equals("com.sun.tools.javac.api.JavacTrees")) {
            return List.of();
        }
        var cls = context.getClassSource().get(name);
        if (cls == null) return List.of();
        var result = new ArrayList<MethodDescriptor>();
        for (var method : cls.getMethods()) {
            var descriptor = method.getDescriptor();
            if (name.equals("com.sun.tools.javac.api.JavacTaskImpl") && descriptor.getName().equals("cleanup")) {
                result.add(descriptor);
            }
            // Original Trees.getJavacTrees uses Class.forName/getMethod/invoke
            // to reach this exact overload; retain its real method and metadata.
            if (name.equals("com.sun.tools.javac.api.JavacTrees") && descriptor.equals(new MethodDescriptor("instance",
                    ValueType.object("javax.tools.JavaCompiler$CompilationTask"),
                    ValueType.object("com.sun.tools.javac.api.JavacTrees")))) result.add(descriptor);
        }
        return result;
    }
}
