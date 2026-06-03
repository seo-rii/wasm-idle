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
import org.jetbrains.kotlin.psi.KtIfExpression;
import org.jetbrains.kotlin.psi.KtNameReferenceExpression;
import org.jetbrains.kotlin.psi.KtNamedFunction;
import org.jetbrains.kotlin.psi.KtParameter;
import org.jetbrains.kotlin.psi.KtProperty;
import org.jetbrains.kotlin.psi.KtReturnExpression;
import org.jetbrains.kotlin.psi.KtStringTemplateEntry;
import org.jetbrains.kotlin.psi.KtStringTemplateExpression;
import org.jetbrains.kotlin.psi.KtUnaryExpression;
import org.jetbrains.kotlin.psi.KtValueArgument;
import org.jetbrains.kotlin.psi.KtWhileExpression;
import org.jetbrains.kotlin.resolve.jvm.diagnostics.JvmDeclarationOrigin;
import org.jetbrains.org.objectweb.asm.Label;
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

        ValueType returnType = returnTypeOf(function);
        String descriptor = descriptorOf(function, returnType);
        MethodVisitor method = builder.newMethod(
                JvmDeclarationOrigin.NO_ORIGIN,
                Opcodes.ACC_PUBLIC | Opcodes.ACC_STATIC | Opcodes.ACC_FINAL,
                name,
                descriptor,
                null,
                new String[0]);
        method.visitCode();

        var context = new MethodContext(builder.getThisName(), returnType);
        for (KtParameter parameter : function.getValueParameters()) {
            String parameterName = parameter.getName();
            if (parameterName == null || parameterName.isEmpty()) {
                throw new IllegalArgumentException("Unsupported unnamed parameter in " + name);
            }
            context.allocate(parameterName, typeOf(parameter));
        }

        KtExpression body = function.getBodyExpression();
        if (body instanceof KtBlockExpression) {
            emitBlock(method, context, (KtBlockExpression) body);
        } else if (body != null) {
            ValueType bodyType = emitExpression(method, context, body);
            emitReturn(method, returnType, bodyType);
            context.hasExplicitReturn = true;
        }
        if (!context.hasExplicitReturn) {
            if (returnType == ValueType.INT) {
                method.visitInsn(Opcodes.ICONST_0);
                method.visitInsn(Opcodes.IRETURN);
            } else if (returnType == ValueType.STRING) {
                method.visitLdcInsn("");
                method.visitInsn(Opcodes.ARETURN);
            } else {
                method.visitInsn(Opcodes.RETURN);
            }
        }
        method.visitMaxs(32, Math.max(1, context.nextLocal));
        method.visitEnd();

        if ("main".equals(name) && function.getValueParameters().isEmpty()) {
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

    private static void emitBlock(MethodVisitor method, MethodContext context, KtBlockExpression block) {
        List<KtExpression> statements = block.getStatements();
        for (KtExpression statement : statements) {
            emitStatement(method, context, statement);
        }
    }

    private static void emitStatement(MethodVisitor method, MethodContext context, KtExpression statement) {
        if (context.hasExplicitReturn) {
            return;
        }
        if (statement instanceof KtBlockExpression) {
            emitBlock(method, context, (KtBlockExpression) statement);
            return;
        }
        if (statement instanceof KtProperty) {
            KtProperty property = (KtProperty) statement;
            KtExpression initializer = property.getInitializer();
            String name = property.getName();
            if (initializer == null || name == null || name.isEmpty()) {
                return;
            }
            ValueType type = emitExpression(method, context, initializer);
            int index = context.allocate(name, type);
            storeLocal(method, type, index);
            return;
        }
        if (statement instanceof KtBinaryExpression) {
            if (emitAssignment(method, context, (KtBinaryExpression) statement)) {
                return;
            }
        }
        if (statement instanceof KtIfExpression) {
            KtIfExpression ifExpression = (KtIfExpression) statement;
            Label elseLabel = new Label();
            Label endLabel = new Label();
            emitConditionJump(method, context, ifExpression.getCondition(), false, elseLabel);
            emitBranch(method, context, ifExpression.getThen());
            if (!context.hasExplicitReturn) {
                method.visitJumpInsn(Opcodes.GOTO, endLabel);
            }
            method.visitLabel(elseLabel);
            boolean thenReturned = context.hasExplicitReturn;
            context.hasExplicitReturn = false;
            emitBranch(method, context, ifExpression.getElse());
            boolean elseReturned = context.hasExplicitReturn;
            context.hasExplicitReturn = thenReturned && elseReturned;
            method.visitLabel(endLabel);
            return;
        }
        if (statement instanceof KtWhileExpression) {
            KtWhileExpression whileExpression = (KtWhileExpression) statement;
            Label startLabel = new Label();
            Label endLabel = new Label();
            method.visitLabel(startLabel);
            emitConditionJump(method, context, whileExpression.getCondition(), false, endLabel);
            emitBranch(method, context, whileExpression.getBody());
            context.hasExplicitReturn = false;
            method.visitJumpInsn(Opcodes.GOTO, startLabel);
            method.visitLabel(endLabel);
            return;
        }
        if (statement instanceof KtReturnExpression) {
            KtExpression returnedExpression = ((KtReturnExpression) statement).getReturnedExpression();
            if (context.returnType == ValueType.VOID || returnedExpression == null) {
                method.visitInsn(Opcodes.RETURN);
                context.hasExplicitReturn = true;
                return;
            }
            ValueType returnedType = emitExpression(method, context, returnedExpression);
            emitReturn(method, context.returnType, returnedType);
            context.hasExplicitReturn = true;
            return;
        }
        if (statement instanceof KtCallExpression) {
            ValueType type = emitExpression(method, context, statement);
            if (type == ValueType.INT) {
                method.visitInsn(Opcodes.POP);
            } else if (type == ValueType.STRING) {
                method.visitInsn(Opcodes.POP);
            }
            return;
        }

        throw new IllegalArgumentException("Unsupported Kotlin statement in browser probe emitter: "
                + statement.getText());
    }

    private static void emitBranch(MethodVisitor method, MethodContext context, KtExpression expression) {
        if (expression == null) {
            return;
        }
        if (expression instanceof KtBlockExpression) {
            emitBlock(method, context, (KtBlockExpression) expression);
        } else {
            emitStatement(method, context, expression);
        }
    }

    private static boolean emitAssignment(MethodVisitor method, MethodContext context, KtBinaryExpression binary) {
        IElementType operation = binary.getOperationToken();
        KtExpression left = binary.getLeft();
        KtExpression right = binary.getRight();
        if (!(left instanceof KtNameReferenceExpression) || right == null) {
            return false;
        }
        Local local = context.locals.get(left.getText());
        if (local == null) {
            throw new IllegalArgumentException("Unknown assignment target: " + left.getText());
        }
        if (operation == KtTokens.EQ) {
            ValueType type = emitExpression(method, context, right);
            if (type != local.type) {
                throw new IllegalArgumentException("Assignment type mismatch for " + left.getText());
            }
            storeLocal(method, local.type, local.index);
            return true;
        }
        if (operation == KtTokens.PLUSEQ || operation == KtTokens.MINUSEQ
                || operation == KtTokens.MULTEQ || operation == KtTokens.DIVEQ
                || operation == KtTokens.PERCEQ) {
            if (local.type != ValueType.INT) {
                throw new IllegalArgumentException("Compound assignment only supports Int: " + binary.getText());
            }
            method.visitVarInsn(Opcodes.ILOAD, local.index);
            ValueType type = emitExpression(method, context, right);
            if (type != ValueType.INT) {
                throw new IllegalArgumentException("Compound assignment type mismatch: " + binary.getText());
            }
            if (operation == KtTokens.PLUSEQ) {
                method.visitInsn(Opcodes.IADD);
            } else if (operation == KtTokens.MINUSEQ) {
                method.visitInsn(Opcodes.ISUB);
            } else if (operation == KtTokens.MULTEQ) {
                method.visitInsn(Opcodes.IMUL);
            } else if (operation == KtTokens.DIVEQ) {
                method.visitInsn(Opcodes.IDIV);
            } else {
                method.visitInsn(Opcodes.IREM);
            }
            method.visitVarInsn(Opcodes.ISTORE, local.index);
            return true;
        }
        return false;
    }

    private static ValueType emitExpression(MethodVisitor method, MethodContext context, KtExpression expression) {
        if (expression == null) {
            throw new IllegalArgumentException("Missing Kotlin expression");
        }
        if (expression instanceof KtConstantExpression) {
            String text = expression.getText();
            if ("true".equals(text)) {
                method.visitInsn(Opcodes.ICONST_1);
                return ValueType.INT;
            }
            if ("false".equals(text)) {
                method.visitInsn(Opcodes.ICONST_0);
                return ValueType.INT;
            }
            method.visitLdcInsn(Integer.parseInt(text));
            return ValueType.INT;
        }
        if (expression instanceof KtUnaryExpression) {
            KtUnaryExpression unary = (KtUnaryExpression) expression;
            if (unary.getOperationToken() == KtTokens.MINUS) {
                ValueType type = emitExpression(method, context, unary.getBaseExpression());
                if (type != ValueType.INT) {
                    throw new IllegalArgumentException("Unary minus only supports Int: " + expression.getText());
                }
                method.visitInsn(Opcodes.INEG);
                return ValueType.INT;
            }
            if (unary.getOperationToken() == KtTokens.EXCL) {
                Label trueLabel = new Label();
                Label endLabel = new Label();
                emitConditionJump(method, context, unary.getBaseExpression(), false, trueLabel);
                method.visitInsn(Opcodes.ICONST_0);
                method.visitJumpInsn(Opcodes.GOTO, endLabel);
                method.visitLabel(trueLabel);
                method.visitInsn(Opcodes.ICONST_1);
                method.visitLabel(endLabel);
                return ValueType.INT;
            }
        }
        if (expression instanceof KtNameReferenceExpression) {
            Local local = context.locals.get(expression.getText());
            if (local == null) {
                throw new IllegalArgumentException("Unknown local: " + expression.getText());
            }
            loadLocal(method, local.type, local.index);
            return local.type;
        }
        if (expression instanceof KtBinaryExpression) {
            KtBinaryExpression binary = (KtBinaryExpression) expression;
            IElementType operation = binary.getOperationToken();
            if (operation == KtTokens.PLUS || operation == KtTokens.MINUS
                    || operation == KtTokens.MUL || operation == KtTokens.DIV
                    || operation == KtTokens.PERC) {
                ValueType leftType = emitExpression(method, context, binary.getLeft());
                ValueType rightType = emitExpression(method, context, binary.getRight());
                if (leftType == ValueType.INT && rightType == ValueType.INT) {
                    if (operation == KtTokens.PLUS) {
                        method.visitInsn(Opcodes.IADD);
                    } else if (operation == KtTokens.MINUS) {
                        method.visitInsn(Opcodes.ISUB);
                    } else if (operation == KtTokens.MUL) {
                        method.visitInsn(Opcodes.IMUL);
                    } else if (operation == KtTokens.DIV) {
                        method.visitInsn(Opcodes.IDIV);
                    } else {
                        method.visitInsn(Opcodes.IREM);
                    }
                    return ValueType.INT;
                }
            }
            if (isComparison(operation) || operation == KtTokens.ANDAND || operation == KtTokens.OROR) {
                Label trueLabel = new Label();
                Label endLabel = new Label();
                emitConditionJump(method, context, expression, true, trueLabel);
                method.visitInsn(Opcodes.ICONST_0);
                method.visitJumpInsn(Opcodes.GOTO, endLabel);
                method.visitLabel(trueLabel);
                method.visitInsn(Opcodes.ICONST_1);
                method.visitLabel(endLabel);
                return ValueType.INT;
            }
            throw new IllegalArgumentException("Unsupported binary expression: " + expression.getText());
        }
        if (expression instanceof KtIfExpression) {
            KtIfExpression ifExpression = (KtIfExpression) expression;
            Label elseLabel = new Label();
            Label endLabel = new Label();
            emitConditionJump(method, context, ifExpression.getCondition(), false, elseLabel);
            ValueType thenType = emitExpression(method, context, ifExpression.getThen());
            method.visitJumpInsn(Opcodes.GOTO, endLabel);
            method.visitLabel(elseLabel);
            ValueType elseType = emitExpression(method, context, ifExpression.getElse());
            if (thenType != elseType) {
                throw new IllegalArgumentException("If expression branches have different types: "
                        + expression.getText());
            }
            method.visitLabel(endLabel);
            return thenType;
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
            String calleeText = callee == null ? "" : callee.getText();
            if (("println".equals(calleeText) || "print".equals(calleeText))
                    && call.getValueArguments().size() == 1) {
                method.visitFieldInsn(Opcodes.GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
                KtValueArgument argument = call.getValueArguments().get(0);
                ValueType type = emitExpression(method, context, argument.getArgumentExpression());
                String methodName = "println".equals(calleeText) ? "println" : "print";
                if (type == ValueType.INT) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", methodName, "(I)V", false);
                    return ValueType.VOID;
                }
                if (type == ValueType.STRING) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", methodName,
                            "(Ljava/lang/String;)V", false);
                    return ValueType.VOID;
                }
            }
            StringBuilder descriptor = new StringBuilder();
            descriptor.append('(');
            for (KtValueArgument argument : call.getValueArguments()) {
                ValueType type = emitExpression(method, context, argument.getArgumentExpression());
                if (type != ValueType.INT) {
                    throw new IllegalArgumentException("Only Int function arguments are supported: "
                            + call.getText());
                }
                descriptor.append('I');
            }
            descriptor.append(")I");
            method.visitMethodInsn(Opcodes.INVOKESTATIC, context.ownerInternalName, calleeText,
                    descriptor.toString(), false);
            return ValueType.INT;
        }
        throw new IllegalArgumentException("Unsupported Kotlin expression in browser probe emitter: "
                + expression.getText());
    }

    private static void emitConditionJump(
            MethodVisitor method, MethodContext context, KtExpression expression, boolean jumpWhenTrue,
            Label target) {
        if (expression instanceof KtBinaryExpression) {
            KtBinaryExpression binary = (KtBinaryExpression) expression;
            IElementType operation = binary.getOperationToken();
            if (operation == KtTokens.ANDAND) {
                if (jumpWhenTrue) {
                    Label falseLabel = new Label();
                    emitConditionJump(method, context, binary.getLeft(), false, falseLabel);
                    emitConditionJump(method, context, binary.getRight(), true, target);
                    method.visitLabel(falseLabel);
                } else {
                    emitConditionJump(method, context, binary.getLeft(), false, target);
                    emitConditionJump(method, context, binary.getRight(), false, target);
                }
                return;
            }
            if (operation == KtTokens.OROR) {
                if (jumpWhenTrue) {
                    emitConditionJump(method, context, binary.getLeft(), true, target);
                    emitConditionJump(method, context, binary.getRight(), true, target);
                } else {
                    Label trueLabel = new Label();
                    emitConditionJump(method, context, binary.getLeft(), true, trueLabel);
                    emitConditionJump(method, context, binary.getRight(), false, target);
                    method.visitLabel(trueLabel);
                }
                return;
            }
            if (isComparison(operation)) {
                ValueType leftType = emitExpression(method, context, binary.getLeft());
                ValueType rightType = emitExpression(method, context, binary.getRight());
                if (leftType != ValueType.INT || rightType != ValueType.INT) {
                    throw new IllegalArgumentException("Only Int comparisons are supported: "
                            + expression.getText());
                }
                method.visitJumpInsn(comparisonOpcode(operation, jumpWhenTrue), target);
                return;
            }
        }
        ValueType type = emitExpression(method, context, expression);
        if (type != ValueType.INT) {
            throw new IllegalArgumentException("Only Int/Boolean conditions are supported: "
                    + expression.getText());
        }
        method.visitJumpInsn(jumpWhenTrue ? Opcodes.IFNE : Opcodes.IFEQ, target);
    }

    private static int comparisonOpcode(IElementType operation, boolean jumpWhenTrue) {
        if (operation == KtTokens.LT) {
            return jumpWhenTrue ? Opcodes.IF_ICMPLT : Opcodes.IF_ICMPGE;
        }
        if (operation == KtTokens.LTEQ) {
            return jumpWhenTrue ? Opcodes.IF_ICMPLE : Opcodes.IF_ICMPGT;
        }
        if (operation == KtTokens.GT) {
            return jumpWhenTrue ? Opcodes.IF_ICMPGT : Opcodes.IF_ICMPLE;
        }
        if (operation == KtTokens.GTEQ) {
            return jumpWhenTrue ? Opcodes.IF_ICMPGE : Opcodes.IF_ICMPLT;
        }
        if (operation == KtTokens.EQEQ || operation == KtTokens.EQEQEQ) {
            return jumpWhenTrue ? Opcodes.IF_ICMPEQ : Opcodes.IF_ICMPNE;
        }
        if (operation == KtTokens.EXCLEQ || operation == KtTokens.EXCLEQEQEQ) {
            return jumpWhenTrue ? Opcodes.IF_ICMPNE : Opcodes.IF_ICMPEQ;
        }
        throw new IllegalArgumentException("Unsupported comparison token: " + operation);
    }

    private static boolean isComparison(IElementType operation) {
        return operation == KtTokens.LT || operation == KtTokens.LTEQ
                || operation == KtTokens.GT || operation == KtTokens.GTEQ
                || operation == KtTokens.EQEQ || operation == KtTokens.EXCLEQ
                || operation == KtTokens.EQEQEQ || operation == KtTokens.EXCLEQEQEQ;
    }

    private static void loadLocal(MethodVisitor method, ValueType type, int index) {
        if (type == ValueType.INT) {
            method.visitVarInsn(Opcodes.ILOAD, index);
        } else {
            method.visitVarInsn(Opcodes.ALOAD, index);
        }
    }

    private static void storeLocal(MethodVisitor method, ValueType type, int index) {
        if (type == ValueType.INT) {
            method.visitVarInsn(Opcodes.ISTORE, index);
        } else {
            method.visitVarInsn(Opcodes.ASTORE, index);
        }
    }

    private static void emitReturn(MethodVisitor method, ValueType expectedType, ValueType actualType) {
        if (expectedType == ValueType.INT && actualType == ValueType.INT) {
            method.visitInsn(Opcodes.IRETURN);
            return;
        }
        if (expectedType == ValueType.STRING && actualType == ValueType.STRING) {
            method.visitInsn(Opcodes.ARETURN);
            return;
        }
        if (expectedType == ValueType.VOID) {
            if (actualType == ValueType.INT || actualType == ValueType.STRING) {
                method.visitInsn(Opcodes.POP);
            }
            method.visitInsn(Opcodes.RETURN);
            return;
        }
        throw new IllegalArgumentException("Return type mismatch: expected " + expectedType
                + ", got " + actualType);
    }

    private static String descriptorOf(KtNamedFunction function, ValueType returnType) {
        StringBuilder descriptor = new StringBuilder();
        descriptor.append('(');
        for (KtParameter parameter : function.getValueParameters()) {
            descriptor.append(typeOf(parameter).descriptor);
        }
        descriptor.append(')');
        descriptor.append(returnType.descriptor);
        return descriptor.toString();
    }

    private static ValueType returnTypeOf(KtNamedFunction function) {
        if ("main".equals(function.getName()) && function.getValueParameters().isEmpty()) {
            return ValueType.VOID;
        }
        if (function.getTypeReference() == null) {
            return ValueType.VOID;
        }
        return typeFromText(function.getTypeReference().getText());
    }

    private static ValueType typeOf(KtParameter parameter) {
        if (parameter.getTypeReference() == null) {
            return ValueType.INT;
        }
        return typeFromText(parameter.getTypeReference().getText());
    }

    private static ValueType typeFromText(String text) {
        if ("Int".equals(text)) {
            return ValueType.INT;
        }
        if ("String".equals(text)) {
            return ValueType.STRING;
        }
        if ("Unit".equals(text)) {
            return ValueType.VOID;
        }
        throw new IllegalArgumentException("Unsupported Kotlin type in browser probe emitter: " + text);
    }

    private enum ValueType {
        INT("I"),
        STRING("Ljava/lang/String;"),
        VOID("V");

        private final String descriptor;

        ValueType(String descriptor) {
            this.descriptor = descriptor;
        }
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
        private final String ownerInternalName;
        private final ValueType returnType;
        private final Map<String, Local> locals = new HashMap<>();
        private int nextLocal;
        private boolean hasExplicitReturn;

        private MethodContext(String ownerInternalName, ValueType returnType) {
            this.ownerInternalName = ownerInternalName;
            this.returnType = returnType;
        }

        private int allocate(String name, ValueType type) {
            int index = nextLocal++;
            locals.put(name, new Local(index, type));
            return index;
        }
    }
}
