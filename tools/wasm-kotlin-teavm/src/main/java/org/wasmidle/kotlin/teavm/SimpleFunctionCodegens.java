package org.wasmidle.kotlin.teavm;

import com.intellij.psi.tree.IElementType;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jetbrains.kotlin.codegen.ClassBuilder;
import org.jetbrains.kotlin.lexer.KtTokens;
import org.jetbrains.kotlin.psi.KtBinaryExpression;
import org.jetbrains.kotlin.psi.KtBlockExpression;
import org.jetbrains.kotlin.psi.KtCallExpression;
import org.jetbrains.kotlin.psi.KtConstantExpression;
import org.jetbrains.kotlin.psi.KtEscapeStringTemplateEntry;
import org.jetbrains.kotlin.psi.KtExpression;
import org.jetbrains.kotlin.psi.KtNamedFunction;
import org.jetbrains.kotlin.psi.KtProperty;
import org.jetbrains.kotlin.psi.KtStringTemplateEntry;
import org.jetbrains.kotlin.psi.KtStringTemplateExpression;
import org.jetbrains.kotlin.psi.KtValueArgument;
import org.jetbrains.kotlin.psi.KtNameReferenceExpression;
import org.jetbrains.kotlin.resolve.jvm.diagnostics.JvmDeclarationOrigin;
import org.jetbrains.org.objectweb.asm.MethodVisitor;
import org.jetbrains.org.objectweb.asm.Opcodes;

public final class SimpleFunctionCodegens {
    private SimpleFunctionCodegens() {
    }

    public static void gen(ClassBuilder builder, KtNamedFunction function) {
        String name = function.getName();
        if (name == null || name.isEmpty()) {
            return;
        }
        MethodVisitor method = builder.newMethod(
                JvmDeclarationOrigin.NO_ORIGIN,
                Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC | Opcodes.ACC_FINAL,
                name,
                "()V",
                null,
                new String[0]);
        method.visitCode();
        var context = new MethodContext();
        KtExpression body = function.getBodyExpression();
        if (body instanceof KtBlockExpression) {
            List<KtExpression> statements = ((KtBlockExpression) body).getStatements();
            for (KtExpression statement : statements) {
                emitStatement(method, context, statement);
            }
        }
        method.visitInsn(Opcodes.RETURN);
        method.visitMaxs(8, Math.max(1, context.nextLocal));
        method.visitEnd();

        if ("main".equals(name)) {
            MethodVisitor bridge = builder.newMethod(
                    JvmDeclarationOrigin.NO_ORIGIN,
                    Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC | Opcodes.ACC_SYNTHETIC,
                    "main",
                    "([Ljava/lang/String;)V",
                    null,
                    new String[0]);
            bridge.visitCode();
            bridge.visitMethodInsn(Opcodes.INVOKESTATIC, builder.getThisName(), "main", "()V", false);
            bridge.visitInsn(Opcodes.RETURN);
            bridge.visitMaxs(0, 1);
            bridge.visitEnd();
        }
    }

    private static void emitStatement(MethodVisitor method, MethodContext context, KtExpression statement) {
        if (statement instanceof KtProperty) {
            KtProperty property = (KtProperty) statement;
            KtExpression initializer = property.getInitializer();
            String name = property.getName();
            if (initializer == null || name == null || name.isEmpty()) {
                return;
            }
            ValueType type = emitExpression(method, context, initializer);
            if (type == ValueType.INT) {
                int index = context.allocate(name, type);
                method.visitVarInsn(Opcodes.ISTORE, index);
            } else if (type == ValueType.STRING) {
                int index = context.allocate(name, type);
                method.visitVarInsn(Opcodes.ASTORE, index);
            } else {
                throw new IllegalArgumentException("Unsupported local property initializer: "
                        + initializer.getText());
            }
            return;
        }

        if (statement instanceof KtCallExpression) {
            KtCallExpression call = (KtCallExpression) statement;
            KtExpression callee = call.getCalleeExpression();
            if (callee != null && "println".equals(callee.getText()) && call.getValueArguments().size() == 1) {
                method.visitFieldInsn(Opcodes.GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
                ValueType type = emitExpression(method, context,
                        call.getValueArguments().get(0).getArgumentExpression());
                if (type == ValueType.INT) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", "println", "(I)V", false);
                } else if (type == ValueType.STRING) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", "println",
                            "(Ljava/lang/String;)V", false);
                } else {
                    throw new IllegalArgumentException("Unsupported println argument: " + call.getText());
                }
                return;
            }
        }

        throw new IllegalArgumentException("Unsupported Kotlin statement in browser probe emitter: "
                + statement.getText());
    }

    private static ValueType emitExpression(MethodVisitor method, MethodContext context, KtExpression expression) {
        if (expression == null) {
            throw new IllegalArgumentException("Missing Kotlin expression");
        }
        if (expression instanceof KtConstantExpression) {
            String text = expression.getText();
            method.visitLdcInsn(Integer.parseInt(text));
            return ValueType.INT;
        }
        if (expression instanceof KtNameReferenceExpression) {
            Local local = context.locals.get(expression.getText());
            if (local == null) {
                throw new IllegalArgumentException("Unknown local: " + expression.getText());
            }
            if (local.type == ValueType.INT) {
                method.visitVarInsn(Opcodes.ILOAD, local.index);
                return ValueType.INT;
            }
            method.visitVarInsn(Opcodes.ALOAD, local.index);
            return local.type;
        }
        if (expression instanceof KtBinaryExpression) {
            KtBinaryExpression binary = (KtBinaryExpression) expression;
            IElementType operation = binary.getOperationToken();
            if (operation == KtTokens.PLUS) {
                ValueType leftType = emitExpression(method, context, binary.getLeft());
                ValueType rightType = emitExpression(method, context, binary.getRight());
                if (leftType == ValueType.INT && rightType == ValueType.INT) {
                    method.visitInsn(Opcodes.IADD);
                    return ValueType.INT;
                }
            }
            throw new IllegalArgumentException("Unsupported binary expression: " + expression.getText());
        }
        if (expression instanceof KtStringTemplateExpression) {
            KtStringTemplateEntry[] entries = ((KtStringTemplateExpression) expression).getEntries();
            method.visitTypeInsn(Opcodes.NEW, "java/lang/StringBuilder");
            method.visitInsn(Opcodes.DUP);
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
            for (KtStringTemplateEntry entry : entries) {
                KtExpression entryExpression = entry.getExpression();
                if (entryExpression == null) {
                    String text = entry instanceof KtEscapeStringTemplateEntry
                            ? ((KtEscapeStringTemplateEntry) entry).getUnescapedValue()
                            : entry.getText();
                    if (!text.isEmpty()) {
                        method.visitLdcInsn(text);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                                "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
                    }
                } else {
                    ValueType type = emitExpression(method, context, entryExpression);
                    if (type == ValueType.INT) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                                "(I)Ljava/lang/StringBuilder;", false);
                    } else if (type == ValueType.STRING) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                                "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
                    } else {
                        throw new IllegalArgumentException("Unsupported string template entry: " + entry.getText());
                    }
                }
            }
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "toString",
                    "()Ljava/lang/String;", false);
            return ValueType.STRING;
        }
        if (expression instanceof KtCallExpression) {
            KtCallExpression call = (KtCallExpression) expression;
            KtExpression callee = call.getCalleeExpression();
            if (callee != null && "println".equals(callee.getText()) && call.getValueArguments().size() == 1) {
                method.visitFieldInsn(Opcodes.GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
                KtValueArgument argument = call.getValueArguments().get(0);
                ValueType type = emitExpression(method, context, argument.getArgumentExpression());
                if (type == ValueType.INT) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", "println", "(I)V", false);
                    return ValueType.VOID;
                }
                if (type == ValueType.STRING) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", "println",
                            "(Ljava/lang/String;)V", false);
                    return ValueType.VOID;
                }
            }
        }
        throw new IllegalArgumentException("Unsupported Kotlin expression in browser probe emitter: "
                + expression.getText());
    }

    private enum ValueType {
        INT,
        STRING,
        VOID
    }

    private static final class Local {
        private final int index;
        private final ValueType type;

        private Local(int index, ValueType type) {
            this.index = index;
            this.type = type;
        }
    }

    private static final class MethodContext {
        private final Map<String, Local> locals = new HashMap<>();
        private int nextLocal;

        private int allocate(String name, ValueType type) {
            int index = nextLocal++;
            locals.put(name, new Local(index, type));
            return index;
        }
    }
}
