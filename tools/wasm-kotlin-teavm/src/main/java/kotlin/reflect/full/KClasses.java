package kotlin.reflect.full;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import kotlin.reflect.KClass;
import kotlin.reflect.KFunction;
import kotlin.reflect.KParameter;
import kotlin.reflect.KType;
import kotlin.reflect.KTypeParameter;
import kotlin.reflect.KVisibility;
import org.jetbrains.kotlin.cli.common.arguments.K2JVMCompilerArguments;

public final class KClasses {
    private KClasses() {
    }

    public static Collection getDeclaredMemberProperties(KClass kClass) {
        return Collections.emptyList();
    }

    public static KFunction getPrimaryConstructor(KClass kClass) {
        return new DefaultArgumentsConstructor(kClass == null ? null : kClass.getQualifiedName());
    }

    public static Collection getMemberProperties(KClass kClass) {
        return Collections.emptyList();
    }

    private static final class DefaultArgumentsConstructor implements KFunction {
        private final String qualifiedName;

        private DefaultArgumentsConstructor(String qualifiedName) {
            this.qualifiedName = qualifiedName;
        }

        @Override
        public Object call(Object... args) {
            return create();
        }

        @Override
        public Object callBy(Map args) {
            return create();
        }

        private Object create() {
            if ("org.jetbrains.kotlin.cli.common.arguments.K2JVMCompilerArguments".equals(qualifiedName)) {
                return new K2JVMCompilerArguments();
            }
            throw new UnsupportedOperationException("No primary constructor stub for " + qualifiedName);
        }

        @Override
        public String getName() {
            return "<init>";
        }

        @Override
        public List<KParameter> getParameters() {
            return Collections.emptyList();
        }

        @Override
        public KType getReturnType() {
            return null;
        }

        @Override
        public List<KTypeParameter> getTypeParameters() {
            return Collections.emptyList();
        }

        @Override
        public KVisibility getVisibility() {
            return KVisibility.PUBLIC;
        }

        @Override
        public boolean isFinal() {
            return true;
        }

        @Override
        public boolean isOpen() {
            return false;
        }

        @Override
        public boolean isAbstract() {
            return false;
        }

        @Override
        public boolean isSuspend() {
            return false;
        }

        @Override
        public boolean isInline() {
            return false;
        }

        @Override
        public boolean isExternal() {
            return false;
        }

        @Override
        public boolean isOperator() {
            return false;
        }

        @Override
        public boolean isInfix() {
            return false;
        }

        @Override
        public List getAnnotations() {
            return Collections.emptyList();
        }
    }
}
