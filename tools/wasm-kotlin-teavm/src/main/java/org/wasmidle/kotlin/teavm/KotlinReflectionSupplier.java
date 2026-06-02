package org.wasmidle.kotlin.teavm;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import org.teavm.classlib.ReflectionContext;
import org.teavm.classlib.ReflectionSupplier;
import org.teavm.model.ClassReader;
import org.teavm.model.ElementModifier;
import org.teavm.model.FieldReader;
import org.teavm.model.ValueType;

public final class KotlinReflectionSupplier implements ReflectionSupplier {
    @Override
    public Collection<String> getAccessibleFields(ReflectionContext context, String className) {
        ClassReader cls = context.getClassSource().get(className);
        if (cls == null) {
            return Collections.emptyList();
        }

        var fields = new ArrayList<String>();
        for (FieldReader field : cls.getFields()) {
            if (!field.hasModifier(ElementModifier.STATIC)) {
                continue;
            }
            if ("INSTANCE".equals(field.getName()) || isDiagnosticFactory(field.getType())) {
                fields.add(field.getName());
            }
        }
        return fields;
    }

    private static boolean isDiagnosticFactory(ValueType type) {
        if (!(type instanceof ValueType.Object objectType)) {
            return false;
        }
        String className = objectType.getClassName();
        return className.startsWith("org.jetbrains.kotlin.diagnostics.DiagnosticFactory");
    }
}
