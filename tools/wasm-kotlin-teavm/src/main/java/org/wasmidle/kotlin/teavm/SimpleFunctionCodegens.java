package org.wasmidle.kotlin.teavm;

import com.intellij.psi.tree.IElementType;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jetbrains.kotlin.codegen.ClassBuilder;
import org.jetbrains.kotlin.lexer.KtTokens;
import org.jetbrains.kotlin.psi.KtArrayAccessExpression;
import org.jetbrains.kotlin.psi.KtBinaryExpression;
import org.jetbrains.kotlin.psi.KtBlockExpression;
import org.jetbrains.kotlin.psi.KtCallExpression;
import org.jetbrains.kotlin.psi.KtConstantExpression;
import org.jetbrains.kotlin.psi.KtDeclaration;
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression;
import org.jetbrains.kotlin.psi.KtEscapeStringTemplateEntry;
import org.jetbrains.kotlin.psi.KtExpression;
import org.jetbrains.kotlin.psi.KtFile;
import org.jetbrains.kotlin.psi.KtIfExpression;
import org.jetbrains.kotlin.psi.KtNameReferenceExpression;
import org.jetbrains.kotlin.psi.KtNamedFunction;
import org.jetbrains.kotlin.psi.KtParameter;
import org.jetbrains.kotlin.psi.KtParenthesizedExpression;
import org.jetbrains.kotlin.psi.KtPostfixExpression;
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
    private static final Set<String> generatedHelpers = new HashSet<>();

    private SimpleFunctionCodegens() {
    }

    public static void clearGeneratedHelpers() {
        generatedHelpers.clear();
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

        var context = new MethodContext(builder, builder.getThisName(), returnType);
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
            emitDefaultReturn(method, returnType);
        }
        method.visitMaxs(48, Math.max(1, context.nextLocal));
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
        if (statement instanceof KtUnaryExpression && isIncrementOperation(
                ((KtUnaryExpression) statement).getOperationToken())) {
            emitIncrementExpression(method, context, (KtUnaryExpression) statement, false);
            return;
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
            popIfNeeded(method, type);
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
        if (right == null) {
            return false;
        }
        if (left instanceof KtArrayAccessExpression) {
            if (operation != KtTokens.EQ) {
                throw new IllegalArgumentException("Array compound assignment is not supported yet: "
                        + binary.getText());
            }
            ValueType arrayType = emitArrayReferenceAndIndex(method, context, (KtArrayAccessExpression) left);
            ValueType valueType = emitExpression(method, context, right);
            if (arrayType == ValueType.INT_ARRAY && valueType == ValueType.INT) {
                method.visitInsn(Opcodes.IASTORE);
                return true;
            }
            if (arrayType == ValueType.LONG_ARRAY && valueType == ValueType.LONG) {
                method.visitInsn(Opcodes.LASTORE);
                return true;
            }
            if (arrayType == ValueType.DOUBLE_ARRAY && valueType == ValueType.DOUBLE) {
                method.visitInsn(Opcodes.DASTORE);
                return true;
            }
            if (arrayType == ValueType.CHAR_ARRAY && valueType == ValueType.CHAR) {
                method.visitInsn(Opcodes.CASTORE);
                return true;
            }
            if (arrayType == ValueType.BOOLEAN_ARRAY && valueType == ValueType.BOOLEAN) {
                method.visitInsn(Opcodes.BASTORE);
                return true;
            }
            throw new IllegalArgumentException("Array assignment type mismatch: " + binary.getText());
        }
        if (!(left instanceof KtNameReferenceExpression)) {
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
            if (!local.type.numeric) {
                throw new IllegalArgumentException("Compound assignment only supports numbers: " + binary.getText());
            }
            loadLocal(method, local.type, local.index);
            ValueType type = emitExpression(method, context, right);
            if (type != local.type) {
                throw new IllegalArgumentException("Compound assignment type mismatch: " + binary.getText());
            }
            emitArithmeticOpcode(method, operation, local.type);
            storeLocal(method, local.type, local.index);
            return true;
        }
        return false;
    }

    private static ValueType emitIncrementExpression(
            MethodVisitor method, MethodContext context, KtUnaryExpression expression, boolean keepResult) {
        KtExpression base = expression.getBaseExpression();
        if (!(base instanceof KtNameReferenceExpression)) {
            throw new IllegalArgumentException("Increment only supports local variables: " + expression.getText());
        }
        Local local = context.locals.get(base.getText());
        if (local == null) {
            throw new IllegalArgumentException("Unknown increment target: " + base.getText());
        }
        if (!local.type.numeric) {
            throw new IllegalArgumentException("Increment only supports numbers: " + expression.getText());
        }
        boolean decrement = expression.getOperationToken() == KtTokens.MINUSMINUS;
        boolean postfix = expression instanceof KtPostfixExpression;
        if (local.type == ValueType.DOUBLE) {
            loadLocal(method, local.type, local.index);
            if (keepResult && postfix) {
                method.visitInsn(Opcodes.DUP2);
            }
            method.visitLdcInsn(Double.valueOf(1));
            method.visitInsn(decrement ? Opcodes.DSUB : Opcodes.DADD);
            if (keepResult && !postfix) {
                method.visitInsn(Opcodes.DUP2);
            }
            storeLocal(method, local.type, local.index);
            return keepResult ? local.type : ValueType.VOID;
        }
        if (local.type == ValueType.LONG) {
            loadLocal(method, local.type, local.index);
            if (keepResult && postfix) {
                method.visitInsn(Opcodes.DUP2);
            }
            method.visitLdcInsn(Long.valueOf(1));
            method.visitInsn(decrement ? Opcodes.LSUB : Opcodes.LADD);
            if (keepResult && !postfix) {
                method.visitInsn(Opcodes.DUP2);
            }
            storeLocal(method, local.type, local.index);
            return keepResult ? local.type : ValueType.VOID;
        }
        loadLocal(method, local.type, local.index);
        if (keepResult && postfix) {
            method.visitInsn(Opcodes.DUP);
        }
        method.visitInsn(Opcodes.ICONST_1);
        method.visitInsn(decrement ? Opcodes.ISUB : Opcodes.IADD);
        if (keepResult && !postfix) {
            method.visitInsn(Opcodes.DUP);
        }
        storeLocal(method, local.type, local.index);
        return keepResult ? local.type : ValueType.VOID;
    }

    private static ValueType emitExpression(MethodVisitor method, MethodContext context, KtExpression expression) {
        if (expression == null) {
            throw new IllegalArgumentException("Missing Kotlin expression");
        }
        if (expression instanceof KtParenthesizedExpression) {
            return emitExpression(method, context, ((KtParenthesizedExpression) expression).getExpression());
        }
        if (expression instanceof KtConstantExpression) {
            String text = expression.getText();
            if ("true".equals(text)) {
                method.visitInsn(Opcodes.ICONST_1);
                return ValueType.BOOLEAN;
            }
            if ("false".equals(text)) {
                method.visitInsn(Opcodes.ICONST_0);
                return ValueType.BOOLEAN;
            }
            if (text.endsWith("L") || text.endsWith("l")) {
                method.visitLdcInsn(Long.valueOf(text.substring(0, text.length() - 1)));
                return ValueType.LONG;
            }
            if (isDoubleLiteralText(text)) {
                method.visitLdcInsn(Double.valueOf(text));
                return ValueType.DOUBLE;
            }
            if (text.length() >= 3 && text.charAt(0) == '\'' && text.charAt(text.length() - 1) == '\'') {
                char value;
                if (text.charAt(1) != '\\') {
                    value = text.charAt(1);
                } else {
                    char escaped = text.charAt(2);
                    if (escaped == 'n') {
                        value = '\n';
                    } else if (escaped == 't') {
                        value = '\t';
                    } else if (escaped == 'r') {
                        value = '\r';
                    } else {
                        value = escaped;
                    }
                }
                method.visitLdcInsn(Integer.valueOf(value));
                return ValueType.CHAR;
            }
            method.visitLdcInsn(Integer.valueOf(text));
            return ValueType.INT;
        }
        if (expression instanceof KtUnaryExpression) {
            KtUnaryExpression unary = (KtUnaryExpression) expression;
            if (unary.getOperationToken() == KtTokens.MINUS) {
                ValueType type = emitExpression(method, context, unary.getBaseExpression());
                if (!type.numeric) {
                    throw new IllegalArgumentException("Unary minus only supports numbers: " + expression.getText());
                }
                method.visitInsn(type == ValueType.LONG ? Opcodes.LNEG : Opcodes.INEG);
                return type;
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
                return ValueType.BOOLEAN;
            }
            if (isIncrementOperation(unary.getOperationToken())) {
                return emitIncrementExpression(method, context, unary, true);
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
        if (expression instanceof KtArrayAccessExpression) {
            ValueType arrayType = emitArrayReferenceAndIndex(method, context, (KtArrayAccessExpression) expression);
            if (arrayType == ValueType.INT_ARRAY) {
                method.visitInsn(Opcodes.IALOAD);
                return ValueType.INT;
            }
            if (arrayType == ValueType.LONG_ARRAY) {
                method.visitInsn(Opcodes.LALOAD);
                return ValueType.LONG;
            }
            if (arrayType == ValueType.DOUBLE_ARRAY) {
                method.visitInsn(Opcodes.DALOAD);
                return ValueType.DOUBLE;
            }
            if (arrayType == ValueType.CHAR_ARRAY) {
                method.visitInsn(Opcodes.CALOAD);
                return ValueType.CHAR;
            }
            if (arrayType == ValueType.BOOLEAN_ARRAY) {
                method.visitInsn(Opcodes.BALOAD);
                return ValueType.BOOLEAN;
            }
            if (arrayType == ValueType.STRING) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "charAt", "(I)C", false);
                return ValueType.CHAR;
            }
            throw new IllegalArgumentException("Unsupported array access: " + expression.getText());
        }
        if (expression instanceof KtDotQualifiedExpression) {
            KtDotQualifiedExpression qualified = (KtDotQualifiedExpression) expression;
            KtExpression receiver = qualified.getReceiverExpression();
            KtExpression selector = qualified.getSelectorExpression();
            if (selector != null && "length".equals(selector.getText())) {
                ValueType receiverType = emitExpression(method, context, receiver);
                if (receiverType == ValueType.STRING) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length", "()I", false);
                    return ValueType.INT;
                }
            }
            if (selector != null && "size".equals(selector.getText())) {
                ValueType receiverType = emitExpression(method, context, receiver);
                if (receiverType.array) {
                    method.visitInsn(Opcodes.ARRAYLENGTH);
                    return ValueType.INT;
                }
            }
            if (selector instanceof KtCallExpression) {
                KtExpression callee = ((KtCallExpression) selector).getCalleeExpression();
                if (callee != null && "toCharArray".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.STRING) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "toCharArray",
                                "()[C", false);
                        return ValueType.CHAR_ARRAY;
                    }
                }
            }
            throw new IllegalArgumentException("Unsupported qualified expression: " + expression.getText());
        }
        if (expression instanceof KtBinaryExpression) {
            KtBinaryExpression binary = (KtBinaryExpression) expression;
            IElementType operation = binary.getOperationToken();
            if (operation == KtTokens.PLUS || operation == KtTokens.MINUS
                    || operation == KtTokens.MUL || operation == KtTokens.DIV
                    || operation == KtTokens.PERC) {
                ValueType leftType = inferExpressionType(context, binary.getLeft());
                ValueType rightType = inferExpressionType(context, binary.getRight());
                if (leftType.numeric && rightType.numeric) {
                    ValueType resultType = promotedNumericType(leftType, rightType);
                    emitExpressionAs(method, context, binary.getLeft(), resultType);
                    emitExpressionAs(method, context, binary.getRight(), resultType);
                    emitArithmeticOpcode(method, operation, resultType);
                    return resultType;
                }
                throw new IllegalArgumentException("Numeric operation type mismatch: " + expression.getText());
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
                return ValueType.BOOLEAN;
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
                    } else if (type == ValueType.LONG) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                                "(J)Ljava/lang/StringBuilder;", false);
                    } else if (type == ValueType.DOUBLE) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                                "(D)Ljava/lang/StringBuilder;", false);
                    } else if (type == ValueType.CHAR) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                                "(C)Ljava/lang/StringBuilder;", false);
                    } else if (type == ValueType.BOOLEAN) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                                "(Z)Ljava/lang/StringBuilder;", false);
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
            return emitCallExpression(method, context, (KtCallExpression) expression);
        }
        throw new IllegalArgumentException("Unsupported Kotlin expression in browser probe emitter: "
                + expression.getText());
    }

    private static ValueType emitCallExpression(MethodVisitor method, MethodContext context, KtCallExpression call) {
        KtExpression callee = call.getCalleeExpression();
        String calleeText = callee == null ? "" : callee.getText();
        if (("println".equals(calleeText) || "print".equals(calleeText)) && call.getValueArguments().size() == 1) {
            method.visitFieldInsn(Opcodes.GETSTATIC, "java/lang/System", "out", "Ljava/io/PrintStream;");
            ValueType type = emitExpression(method, context,
                    call.getValueArguments().get(0).getArgumentExpression());
            String methodName = "println".equals(calleeText) ? "println" : "print";
            if (type == ValueType.INT) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", methodName, "(I)V", false);
                return ValueType.VOID;
            }
            if (type == ValueType.LONG) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", methodName, "(J)V", false);
                return ValueType.VOID;
            }
            if (type == ValueType.DOUBLE) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", methodName, "(D)V", false);
                return ValueType.VOID;
            }
            if (type == ValueType.CHAR) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", methodName, "(C)V", false);
                return ValueType.VOID;
            }
            if (type == ValueType.BOOLEAN) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", methodName, "(Z)V", false);
                return ValueType.VOID;
            }
            if (type == ValueType.STRING) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/PrintStream", methodName,
                        "(Ljava/lang/String;)V", false);
                return ValueType.VOID;
            }
        }
        if (("IntArray".equals(calleeText) || "LongArray".equals(calleeText)
                || "DoubleArray".equals(calleeText)
                || "CharArray".equals(calleeText)
                || "BooleanArray".equals(calleeText)) && call.getValueArguments().size() == 1) {
            ValueType sizeType = emitExpression(method, context,
                    call.getValueArguments().get(0).getArgumentExpression());
            if (sizeType != ValueType.INT) {
                throw new IllegalArgumentException("Array size must be Int: " + call.getText());
            }
            if ("IntArray".equals(calleeText)) {
                method.visitIntInsn(Opcodes.NEWARRAY, Opcodes.T_INT);
                return ValueType.INT_ARRAY;
            }
            if ("BooleanArray".equals(calleeText)) {
                method.visitIntInsn(Opcodes.NEWARRAY, Opcodes.T_BOOLEAN);
                return ValueType.BOOLEAN_ARRAY;
            }
            if ("DoubleArray".equals(calleeText)) {
                method.visitIntInsn(Opcodes.NEWARRAY, Opcodes.T_DOUBLE);
                return ValueType.DOUBLE_ARRAY;
            }
            if ("CharArray".equals(calleeText)) {
                method.visitIntInsn(Opcodes.NEWARRAY, Opcodes.T_CHAR);
                return ValueType.CHAR_ARRAY;
            }
            method.visitIntInsn(Opcodes.NEWARRAY, Opcodes.T_LONG);
            return ValueType.LONG_ARRAY;
        }
        if ("readInt".equals(calleeText) && call.getValueArguments().isEmpty()) {
            ensureReadIntHelper(context);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, context.ownerInternalName, "__wasmIdleReadInt", "()I",
                    false);
            return ValueType.INT;
        }
        if ("readLong".equals(calleeText) && call.getValueArguments().isEmpty()) {
            ensureReadLongHelper(context);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, context.ownerInternalName, "__wasmIdleReadLong", "()J",
                    false);
            return ValueType.LONG;
        }
        if ("readDouble".equals(calleeText) && call.getValueArguments().isEmpty()) {
            ensureReadStringHelper(context);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, context.ownerInternalName, "__wasmIdleReadString",
                    "()Ljava/lang/String;", false);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Double", "parseDouble",
                    "(Ljava/lang/String;)D", false);
            return ValueType.DOUBLE;
        }
        if ("readString".equals(calleeText) && call.getValueArguments().isEmpty()) {
            ensureReadStringHelper(context);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, context.ownerInternalName, "__wasmIdleReadString",
                    "()Ljava/lang/String;", false);
            return ValueType.STRING;
        }
        if ("abs".equals(calleeText) && call.getValueArguments().size() == 1) {
            KtExpression argument = call.getValueArguments().get(0).getArgumentExpression();
            ValueType type = inferExpressionType(context, argument);
            if (!type.numeric) {
                throw new IllegalArgumentException("abs only supports numbers: " + call.getText());
            }
            emitExpressionAs(method, context, argument, type);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Math", "abs",
                    "(" + type.descriptor + ")" + type.descriptor, false);
            return type;
        }
        if (("minOf".equals(calleeText) || "maxOf".equals(calleeText))
                && call.getValueArguments().size() == 2) {
            KtExpression left = call.getValueArguments().get(0).getArgumentExpression();
            KtExpression right = call.getValueArguments().get(1).getArgumentExpression();
            ValueType leftType = inferExpressionType(context, left);
            ValueType rightType = inferExpressionType(context, right);
            if (!leftType.numeric || !rightType.numeric) {
                throw new IllegalArgumentException(calleeText + " only supports numbers: " + call.getText());
            }
            ValueType type = promotedNumericType(leftType, rightType);
            emitExpressionAs(method, context, left, type);
            emitExpressionAs(method, context, right, type);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Math",
                    "minOf".equals(calleeText) ? "min" : "max",
                    "(" + type.descriptor + type.descriptor + ")" + type.descriptor, false);
            return type;
        }

        FunctionSignature signature = findFunctionSignature(calleeText);
        if (signature == null) {
            throw new IllegalArgumentException("Unknown function call: " + call.getText());
        }
        if (call.getValueArguments().size() != signature.parameterTypes.length) {
            throw new IllegalArgumentException("Function argument count mismatch: " + call.getText());
        }
        for (int i = 0; i < signature.parameterTypes.length; i++) {
            emitExpressionAs(method, context, call.getValueArguments().get(i).getArgumentExpression(),
                    signature.parameterTypes[i]);
        }
        method.visitMethodInsn(Opcodes.INVOKESTATIC, context.ownerInternalName, calleeText,
                signature.descriptor, false);
        return signature.returnType;
    }

    private static void emitExpressionAs(
            MethodVisitor method, MethodContext context, KtExpression expression, ValueType expectedType) {
        ValueType actualType = emitExpression(method, context, expression);
        if (actualType == expectedType) {
            return;
        }
        if (actualType == ValueType.INT && expectedType == ValueType.LONG) {
            method.visitInsn(Opcodes.I2L);
            return;
        }
        if (actualType == ValueType.INT && expectedType == ValueType.DOUBLE) {
            method.visitInsn(Opcodes.I2D);
            return;
        }
        if (actualType == ValueType.LONG && expectedType == ValueType.DOUBLE) {
            method.visitInsn(Opcodes.L2D);
            return;
        }
        throw new IllegalArgumentException("Expression type mismatch: expected " + expectedType
                + ", got " + actualType + " for " + expression.getText());
    }

    private static ValueType inferExpressionType(MethodContext context, KtExpression expression) {
        if (expression instanceof KtParenthesizedExpression) {
            return inferExpressionType(context, ((KtParenthesizedExpression) expression).getExpression());
        }
        if (expression instanceof KtConstantExpression) {
            String text = expression.getText();
            if ("true".equals(text) || "false".equals(text)) {
                return ValueType.BOOLEAN;
            }
            if (isDoubleLiteralText(text)) {
                return ValueType.DOUBLE;
            }
            if (text.length() >= 3 && text.charAt(0) == '\'' && text.charAt(text.length() - 1) == '\'') {
                return ValueType.CHAR;
            }
            return text.endsWith("L") || text.endsWith("l") ? ValueType.LONG : ValueType.INT;
        }
        if (expression instanceof KtUnaryExpression) {
            KtUnaryExpression unary = (KtUnaryExpression) expression;
            if (unary.getOperationToken() == KtTokens.EXCL) {
                return ValueType.BOOLEAN;
            }
            return inferExpressionType(context, unary.getBaseExpression());
        }
        if (expression instanceof KtNameReferenceExpression) {
            Local local = context.locals.get(expression.getText());
            if (local == null) {
                throw new IllegalArgumentException("Unknown local: " + expression.getText());
            }
            return local.type;
        }
        if (expression instanceof KtArrayAccessExpression) {
            KtExpression arrayExpression = ((KtArrayAccessExpression) expression).getArrayExpression();
            if (!(arrayExpression instanceof KtNameReferenceExpression)) {
                throw new IllegalArgumentException("Only local array type inference is supported: "
                        + expression.getText());
            }
            Local local = context.locals.get(arrayExpression.getText());
            if (local == null) {
                throw new IllegalArgumentException("Unknown array local: " + arrayExpression.getText());
            }
            if (local.type == ValueType.INT_ARRAY) {
                return ValueType.INT;
            }
            if (local.type == ValueType.LONG_ARRAY) {
                return ValueType.LONG;
            }
            if (local.type == ValueType.DOUBLE_ARRAY) {
                return ValueType.DOUBLE;
            }
            if (local.type == ValueType.CHAR_ARRAY) {
                return ValueType.CHAR;
            }
            if (local.type == ValueType.BOOLEAN_ARRAY) {
                return ValueType.BOOLEAN;
            }
            if (local.type == ValueType.STRING) {
                return ValueType.CHAR;
            }
            throw new IllegalArgumentException("Unsupported array type: " + expression.getText());
        }
        if (expression instanceof KtDotQualifiedExpression) {
            KtDotQualifiedExpression qualified = (KtDotQualifiedExpression) expression;
            KtExpression selector = qualified.getSelectorExpression();
            if (selector != null && "length".equals(selector.getText())
                    && inferExpressionType(context, qualified.getReceiverExpression()) == ValueType.STRING) {
                return ValueType.INT;
            }
            if (selector != null && "size".equals(selector.getText())
                    && inferExpressionType(context, qualified.getReceiverExpression()).array) {
                return ValueType.INT;
            }
            if (selector instanceof KtCallExpression) {
                KtExpression callee = ((KtCallExpression) selector).getCalleeExpression();
                if (callee != null && "toCharArray".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()
                        && inferExpressionType(context, qualified.getReceiverExpression()) == ValueType.STRING) {
                    return ValueType.CHAR_ARRAY;
                }
            }
        }
        if (expression instanceof KtBinaryExpression) {
            KtBinaryExpression binary = (KtBinaryExpression) expression;
            IElementType operation = binary.getOperationToken();
            if (isComparison(operation) || operation == KtTokens.ANDAND || operation == KtTokens.OROR) {
                return ValueType.BOOLEAN;
            }
            ValueType leftType = inferExpressionType(context, binary.getLeft());
            ValueType rightType = inferExpressionType(context, binary.getRight());
            if (leftType.numeric && rightType.numeric) {
                return promotedNumericType(leftType, rightType);
            }
        }
        if (expression instanceof KtStringTemplateExpression) {
            return ValueType.STRING;
        }
        if (expression instanceof KtCallExpression) {
            KtExpression callee = ((KtCallExpression) expression).getCalleeExpression();
            String calleeText = callee == null ? "" : callee.getText();
            if ("readInt".equals(calleeText)) {
                return ValueType.INT;
            }
            if ("readLong".equals(calleeText)) {
                return ValueType.LONG;
            }
            if ("readDouble".equals(calleeText)) {
                return ValueType.DOUBLE;
            }
            if ("readString".equals(calleeText)) {
                return ValueType.STRING;
            }
            if ("IntArray".equals(calleeText)) {
                return ValueType.INT_ARRAY;
            }
            if ("LongArray".equals(calleeText)) {
                return ValueType.LONG_ARRAY;
            }
            if ("DoubleArray".equals(calleeText)) {
                return ValueType.DOUBLE_ARRAY;
            }
            if ("CharArray".equals(calleeText)) {
                return ValueType.CHAR_ARRAY;
            }
            if ("BooleanArray".equals(calleeText)) {
                return ValueType.BOOLEAN_ARRAY;
            }
            if ("abs".equals(calleeText) && ((KtCallExpression) expression).getValueArguments().size() == 1) {
                ValueType type = inferExpressionType(context,
                        ((KtCallExpression) expression).getValueArguments().get(0).getArgumentExpression());
                if (type.numeric) {
                    return type;
                }
            }
            if (("minOf".equals(calleeText) || "maxOf".equals(calleeText))
                    && ((KtCallExpression) expression).getValueArguments().size() == 2) {
                ValueType leftType = inferExpressionType(context,
                        ((KtCallExpression) expression).getValueArguments().get(0).getArgumentExpression());
                ValueType rightType = inferExpressionType(context,
                        ((KtCallExpression) expression).getValueArguments().get(1).getArgumentExpression());
                if (leftType.numeric && rightType.numeric) {
                    return promotedNumericType(leftType, rightType);
                }
            }
            FunctionSignature signature = findFunctionSignature(calleeText);
            if (signature != null) {
                return signature.returnType;
            }
        }
        throw new IllegalArgumentException("Could not infer expression type: " + expression.getText());
    }

    private static ValueType emitArrayReferenceAndIndex(
            MethodVisitor method, MethodContext context, KtArrayAccessExpression expression) {
        KtExpression arrayExpression = expression.getArrayExpression();
        if (!(arrayExpression instanceof KtNameReferenceExpression) || expression.getIndexExpressions().size() != 1) {
            throw new IllegalArgumentException("Only local one-dimensional arrays are supported: "
                    + expression.getText());
        }
        Local local = context.locals.get(arrayExpression.getText());
        if (local == null || (!local.type.array && local.type != ValueType.STRING)) {
            throw new IllegalArgumentException("Unknown array local: " + arrayExpression.getText());
        }
        method.visitVarInsn(Opcodes.ALOAD, local.index);
        ValueType indexType = emitExpression(method, context, expression.getIndexExpressions().get(0));
        if (indexType != ValueType.INT) {
            throw new IllegalArgumentException("Array index must be Int: " + expression.getText());
        }
        return local.type;
    }

    private static void ensureReadStringHelper(MethodContext context) {
        String key = context.ownerInternalName + ".__wasmIdleReadString";
        if (!generatedHelpers.add(key)) {
            return;
        }
        MethodVisitor method = context.builder.newMethod(
                JvmDeclarationOrigin.NO_ORIGIN,
                Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC,
                "__wasmIdleReadString",
                "()Ljava/lang/String;",
                null,
                new String[0]);
        method.visitCode();

        Label skipWhitespace = new Label();
        Label afterWhitespace = new Label();
        Label tokenLoop = new Label();
        Label end = new Label();

        method.visitLabel(skipWhitespace);
        emitReadByte(method);
        method.visitVarInsn(Opcodes.ISTORE, 0);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitJumpInsn(Opcodes.IFLT, afterWhitespace);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitIntInsn(Opcodes.BIPUSH, 32);
        method.visitJumpInsn(Opcodes.IF_ICMPGT, afterWhitespace);
        method.visitJumpInsn(Opcodes.GOTO, skipWhitespace);

        method.visitLabel(afterWhitespace);
        method.visitTypeInsn(Opcodes.NEW, "java/lang/StringBuilder");
        method.visitInsn(Opcodes.DUP);
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
        method.visitVarInsn(Opcodes.ASTORE, 1);

        method.visitLabel(tokenLoop);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitJumpInsn(Opcodes.IFLT, end);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitIntInsn(Opcodes.BIPUSH, 32);
        method.visitJumpInsn(Opcodes.IF_ICMPLE, end);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitInsn(Opcodes.I2C);
        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                "(C)Ljava/lang/StringBuilder;", false);
        method.visitInsn(Opcodes.POP);
        emitReadByte(method);
        method.visitVarInsn(Opcodes.ISTORE, 0);
        method.visitJumpInsn(Opcodes.GOTO, tokenLoop);

        method.visitLabel(end);
        method.visitVarInsn(Opcodes.ALOAD, 1);
        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "toString",
                "()Ljava/lang/String;", false);
        method.visitInsn(Opcodes.ARETURN);
        method.visitMaxs(3, 2);
        method.visitEnd();
    }

    private static void ensureReadIntHelper(MethodContext context) {
        String key = context.ownerInternalName + ".__wasmIdleReadInt";
        if (!generatedHelpers.add(key)) {
            return;
        }
        MethodVisitor method = context.builder.newMethod(
                JvmDeclarationOrigin.NO_ORIGIN,
                Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC,
                "__wasmIdleReadInt",
                "()I",
                null,
                new String[0]);
        method.visitCode();

        Label skipWhitespace = new Label();
        Label afterWhitespace = new Label();
        Label afterSign = new Label();
        Label digitLoop = new Label();
        Label end = new Label();

        method.visitLabel(skipWhitespace);
        emitReadByte(method);
        method.visitVarInsn(Opcodes.ISTORE, 0);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitJumpInsn(Opcodes.IFLT, afterWhitespace);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitIntInsn(Opcodes.BIPUSH, 32);
        method.visitJumpInsn(Opcodes.IF_ICMPGT, afterWhitespace);
        method.visitJumpInsn(Opcodes.GOTO, skipWhitespace);

        method.visitLabel(afterWhitespace);
        method.visitInsn(Opcodes.ICONST_1);
        method.visitVarInsn(Opcodes.ISTORE, 1);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitIntInsn(Opcodes.BIPUSH, 45);
        method.visitJumpInsn(Opcodes.IF_ICMPNE, afterSign);
        method.visitInsn(Opcodes.ICONST_M1);
        method.visitVarInsn(Opcodes.ISTORE, 1);
        emitReadByte(method);
        method.visitVarInsn(Opcodes.ISTORE, 0);

        method.visitLabel(afterSign);
        method.visitInsn(Opcodes.ICONST_0);
        method.visitVarInsn(Opcodes.ISTORE, 2);

        method.visitLabel(digitLoop);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitIntInsn(Opcodes.BIPUSH, 32);
        method.visitJumpInsn(Opcodes.IF_ICMPLE, end);
        method.visitVarInsn(Opcodes.ILOAD, 2);
        method.visitIntInsn(Opcodes.BIPUSH, 10);
        method.visitInsn(Opcodes.IMUL);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitInsn(Opcodes.IADD);
        method.visitIntInsn(Opcodes.BIPUSH, 48);
        method.visitInsn(Opcodes.ISUB);
        method.visitVarInsn(Opcodes.ISTORE, 2);
        emitReadByte(method);
        method.visitVarInsn(Opcodes.ISTORE, 0);
        method.visitJumpInsn(Opcodes.GOTO, digitLoop);

        method.visitLabel(end);
        method.visitVarInsn(Opcodes.ILOAD, 2);
        method.visitVarInsn(Opcodes.ILOAD, 1);
        method.visitInsn(Opcodes.IMUL);
        method.visitInsn(Opcodes.IRETURN);
        method.visitMaxs(4, 3);
        method.visitEnd();
    }

    private static void ensureReadLongHelper(MethodContext context) {
        String key = context.ownerInternalName + ".__wasmIdleReadLong";
        if (!generatedHelpers.add(key)) {
            return;
        }
        MethodVisitor method = context.builder.newMethod(
                JvmDeclarationOrigin.NO_ORIGIN,
                Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC,
                "__wasmIdleReadLong",
                "()J",
                null,
                new String[0]);
        method.visitCode();

        Label skipWhitespace = new Label();
        Label afterWhitespace = new Label();
        Label afterSign = new Label();
        Label digitLoop = new Label();
        Label end = new Label();
        Label negative = new Label();

        method.visitLabel(skipWhitespace);
        emitReadByte(method);
        method.visitVarInsn(Opcodes.ISTORE, 0);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitJumpInsn(Opcodes.IFLT, afterWhitespace);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitIntInsn(Opcodes.BIPUSH, 32);
        method.visitJumpInsn(Opcodes.IF_ICMPGT, afterWhitespace);
        method.visitJumpInsn(Opcodes.GOTO, skipWhitespace);

        method.visitLabel(afterWhitespace);
        method.visitInsn(Opcodes.ICONST_1);
        method.visitVarInsn(Opcodes.ISTORE, 1);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitIntInsn(Opcodes.BIPUSH, 45);
        method.visitJumpInsn(Opcodes.IF_ICMPNE, afterSign);
        method.visitInsn(Opcodes.ICONST_M1);
        method.visitVarInsn(Opcodes.ISTORE, 1);
        emitReadByte(method);
        method.visitVarInsn(Opcodes.ISTORE, 0);

        method.visitLabel(afterSign);
        method.visitInsn(Opcodes.LCONST_0);
        method.visitVarInsn(Opcodes.LSTORE, 2);

        method.visitLabel(digitLoop);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitIntInsn(Opcodes.BIPUSH, 32);
        method.visitJumpInsn(Opcodes.IF_ICMPLE, end);
        method.visitVarInsn(Opcodes.LLOAD, 2);
        method.visitLdcInsn(Long.valueOf(10));
        method.visitInsn(Opcodes.LMUL);
        method.visitVarInsn(Opcodes.ILOAD, 0);
        method.visitInsn(Opcodes.I2L);
        method.visitInsn(Opcodes.LADD);
        method.visitLdcInsn(Long.valueOf(48));
        method.visitInsn(Opcodes.LSUB);
        method.visitVarInsn(Opcodes.LSTORE, 2);
        emitReadByte(method);
        method.visitVarInsn(Opcodes.ISTORE, 0);
        method.visitJumpInsn(Opcodes.GOTO, digitLoop);

        method.visitLabel(end);
        method.visitVarInsn(Opcodes.ILOAD, 1);
        method.visitJumpInsn(Opcodes.IFLT, negative);
        method.visitVarInsn(Opcodes.LLOAD, 2);
        method.visitInsn(Opcodes.LRETURN);

        method.visitLabel(negative);
        method.visitVarInsn(Opcodes.LLOAD, 2);
        method.visitInsn(Opcodes.LNEG);
        method.visitInsn(Opcodes.LRETURN);
        method.visitMaxs(5, 4);
        method.visitEnd();
    }

    private static void emitReadByte(MethodVisitor method) {
        method.visitFieldInsn(Opcodes.GETSTATIC, "java/lang/System", "in", "Ljava/io/InputStream;");
        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/io/InputStream", "read", "()I", false);
    }

    private static void emitConditionJump(
            MethodVisitor method, MethodContext context, KtExpression expression, boolean jumpWhenTrue,
            Label target) {
        if (expression instanceof KtParenthesizedExpression) {
            emitConditionJump(method, context, ((KtParenthesizedExpression) expression).getExpression(),
                    jumpWhenTrue, target);
            return;
        }
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
                ValueType leftType = inferExpressionType(context, binary.getLeft());
                ValueType rightType = inferExpressionType(context, binary.getRight());
                boolean comparable = (leftType.numeric && rightType.numeric)
                        || (leftType == ValueType.CHAR && rightType == ValueType.CHAR)
                        || (leftType == ValueType.BOOLEAN && rightType == ValueType.BOOLEAN
                                && isEqualityComparison(operation));
                if (!comparable) {
                    throw new IllegalArgumentException("Comparison type mismatch: " + expression.getText());
                }
                ValueType comparisonType = leftType == ValueType.DOUBLE || rightType == ValueType.DOUBLE
                        ? ValueType.DOUBLE
                        : leftType == ValueType.LONG || rightType == ValueType.LONG
                        ? ValueType.LONG
                        : leftType == ValueType.CHAR ? ValueType.CHAR
                                : leftType == ValueType.BOOLEAN ? ValueType.BOOLEAN : ValueType.INT;
                emitExpressionAs(method, context, binary.getLeft(), comparisonType);
                emitExpressionAs(method, context, binary.getRight(), comparisonType);
                if (comparisonType == ValueType.LONG) {
                    method.visitInsn(Opcodes.LCMP);
                    method.visitJumpInsn(comparisonZeroOpcode(operation, jumpWhenTrue), target);
                } else if (comparisonType == ValueType.DOUBLE) {
                    method.visitInsn(Opcodes.DCMPL);
                    method.visitJumpInsn(comparisonZeroOpcode(operation, jumpWhenTrue), target);
                } else {
                    method.visitJumpInsn(comparisonOpcode(operation, jumpWhenTrue), target);
                }
                return;
            }
        }
        ValueType type = emitExpression(method, context, expression);
        if (type != ValueType.INT && type != ValueType.BOOLEAN) {
            throw new IllegalArgumentException("Only Int/Boolean conditions are supported: "
                    + expression.getText());
        }
        method.visitJumpInsn(jumpWhenTrue ? Opcodes.IFNE : Opcodes.IFEQ, target);
    }

    private static void emitArithmeticOpcode(MethodVisitor method, IElementType operation, ValueType type) {
        if (type == ValueType.DOUBLE) {
            if (operation == KtTokens.PLUS || operation == KtTokens.PLUSEQ) {
                method.visitInsn(Opcodes.DADD);
            } else if (operation == KtTokens.MINUS || operation == KtTokens.MINUSEQ) {
                method.visitInsn(Opcodes.DSUB);
            } else if (operation == KtTokens.MUL || operation == KtTokens.MULTEQ) {
                method.visitInsn(Opcodes.DMUL);
            } else if (operation == KtTokens.DIV || operation == KtTokens.DIVEQ) {
                method.visitInsn(Opcodes.DDIV);
            } else {
                method.visitInsn(Opcodes.DREM);
            }
            return;
        }
        if (type == ValueType.LONG) {
            if (operation == KtTokens.PLUS || operation == KtTokens.PLUSEQ) {
                method.visitInsn(Opcodes.LADD);
            } else if (operation == KtTokens.MINUS || operation == KtTokens.MINUSEQ) {
                method.visitInsn(Opcodes.LSUB);
            } else if (operation == KtTokens.MUL || operation == KtTokens.MULTEQ) {
                method.visitInsn(Opcodes.LMUL);
            } else if (operation == KtTokens.DIV || operation == KtTokens.DIVEQ) {
                method.visitInsn(Opcodes.LDIV);
            } else {
                method.visitInsn(Opcodes.LREM);
            }
            return;
        }
        if (operation == KtTokens.PLUS || operation == KtTokens.PLUSEQ) {
            method.visitInsn(Opcodes.IADD);
        } else if (operation == KtTokens.MINUS || operation == KtTokens.MINUSEQ) {
            method.visitInsn(Opcodes.ISUB);
        } else if (operation == KtTokens.MUL || operation == KtTokens.MULTEQ) {
            method.visitInsn(Opcodes.IMUL);
        } else if (operation == KtTokens.DIV || operation == KtTokens.DIVEQ) {
            method.visitInsn(Opcodes.IDIV);
        } else {
            method.visitInsn(Opcodes.IREM);
        }
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

    private static int comparisonZeroOpcode(IElementType operation, boolean jumpWhenTrue) {
        if (operation == KtTokens.LT) {
            return jumpWhenTrue ? Opcodes.IFLT : Opcodes.IFGE;
        }
        if (operation == KtTokens.LTEQ) {
            return jumpWhenTrue ? Opcodes.IFLE : Opcodes.IFGT;
        }
        if (operation == KtTokens.GT) {
            return jumpWhenTrue ? Opcodes.IFGT : Opcodes.IFLE;
        }
        if (operation == KtTokens.GTEQ) {
            return jumpWhenTrue ? Opcodes.IFGE : Opcodes.IFLT;
        }
        if (operation == KtTokens.EQEQ || operation == KtTokens.EQEQEQ) {
            return jumpWhenTrue ? Opcodes.IFEQ : Opcodes.IFNE;
        }
        if (operation == KtTokens.EXCLEQ || operation == KtTokens.EXCLEQEQEQ) {
            return jumpWhenTrue ? Opcodes.IFNE : Opcodes.IFEQ;
        }
        throw new IllegalArgumentException("Unsupported comparison token: " + operation);
    }

    private static boolean isComparison(IElementType operation) {
        return operation == KtTokens.LT || operation == KtTokens.LTEQ
                || operation == KtTokens.GT || operation == KtTokens.GTEQ
                || operation == KtTokens.EQEQ || operation == KtTokens.EXCLEQ
                || operation == KtTokens.EQEQEQ || operation == KtTokens.EXCLEQEQEQ;
    }

    private static boolean isIncrementOperation(IElementType operation) {
        return operation == KtTokens.PLUSPLUS || operation == KtTokens.MINUSMINUS;
    }

    private static boolean isEqualityComparison(IElementType operation) {
        return operation == KtTokens.EQEQ || operation == KtTokens.EXCLEQ
                || operation == KtTokens.EQEQEQ || operation == KtTokens.EXCLEQEQEQ;
    }

    private static void loadLocal(MethodVisitor method, ValueType type, int index) {
        if (type == ValueType.INT || type == ValueType.CHAR || type == ValueType.BOOLEAN) {
            method.visitVarInsn(Opcodes.ILOAD, index);
        } else if (type == ValueType.LONG) {
            method.visitVarInsn(Opcodes.LLOAD, index);
        } else if (type == ValueType.DOUBLE) {
            method.visitVarInsn(Opcodes.DLOAD, index);
        } else {
            method.visitVarInsn(Opcodes.ALOAD, index);
        }
    }

    private static void storeLocal(MethodVisitor method, ValueType type, int index) {
        if (type == ValueType.INT || type == ValueType.CHAR || type == ValueType.BOOLEAN) {
            method.visitVarInsn(Opcodes.ISTORE, index);
        } else if (type == ValueType.LONG) {
            method.visitVarInsn(Opcodes.LSTORE, index);
        } else if (type == ValueType.DOUBLE) {
            method.visitVarInsn(Opcodes.DSTORE, index);
        } else {
            method.visitVarInsn(Opcodes.ASTORE, index);
        }
    }

    private static void popIfNeeded(MethodVisitor method, ValueType type) {
        if (type == ValueType.LONG || type == ValueType.DOUBLE) {
            method.visitInsn(Opcodes.POP2);
        } else if (type != ValueType.VOID) {
            method.visitInsn(Opcodes.POP);
        }
    }

    private static void emitReturn(MethodVisitor method, ValueType expectedType, ValueType actualType) {
        if (expectedType == actualType) {
            if (expectedType == ValueType.INT || expectedType == ValueType.CHAR
                    || expectedType == ValueType.BOOLEAN) {
                method.visitInsn(Opcodes.IRETURN);
            } else if (expectedType == ValueType.LONG) {
                method.visitInsn(Opcodes.LRETURN);
            } else if (expectedType == ValueType.DOUBLE) {
                method.visitInsn(Opcodes.DRETURN);
            } else if (expectedType == ValueType.VOID) {
                method.visitInsn(Opcodes.RETURN);
            } else {
                method.visitInsn(Opcodes.ARETURN);
            }
            return;
        }
        if (expectedType == ValueType.VOID) {
            popIfNeeded(method, actualType);
            method.visitInsn(Opcodes.RETURN);
            return;
        }
        throw new IllegalArgumentException("Return type mismatch: expected " + expectedType
                + ", got " + actualType);
    }

    private static void emitDefaultReturn(MethodVisitor method, ValueType returnType) {
        if (returnType == ValueType.INT || returnType == ValueType.CHAR || returnType == ValueType.BOOLEAN) {
            method.visitInsn(Opcodes.ICONST_0);
            method.visitInsn(Opcodes.IRETURN);
        } else if (returnType == ValueType.LONG) {
            method.visitInsn(Opcodes.LCONST_0);
            method.visitInsn(Opcodes.LRETURN);
        } else if (returnType == ValueType.DOUBLE) {
            method.visitInsn(Opcodes.DCONST_0);
            method.visitInsn(Opcodes.DRETURN);
        } else if (returnType == ValueType.STRING) {
            method.visitLdcInsn("");
            method.visitInsn(Opcodes.ARETURN);
        } else if (returnType == ValueType.INT_ARRAY || returnType == ValueType.LONG_ARRAY
                || returnType == ValueType.DOUBLE_ARRAY || returnType == ValueType.CHAR_ARRAY
                || returnType == ValueType.BOOLEAN_ARRAY) {
            method.visitInsn(Opcodes.ACONST_NULL);
            method.visitInsn(Opcodes.ARETURN);
        } else {
            method.visitInsn(Opcodes.RETURN);
        }
    }

    private static FunctionSignature findFunctionSignature(String name) {
        for (KtFile file : SimpleSourceRegistry.files()) {
            for (KtDeclaration declaration : file.getDeclarations()) {
                if (declaration instanceof KtNamedFunction) {
                    KtNamedFunction function = (KtNamedFunction) declaration;
                    if (name.equals(function.getName())) {
                        ValueType returnType = returnTypeOf(function);
                        ValueType[] parameterTypes = new ValueType[function.getValueParameters().size()];
                        for (int i = 0; i < parameterTypes.length; i++) {
                            parameterTypes[i] = typeOf(function.getValueParameters().get(i));
                        }
                        return new FunctionSignature(parameterTypes, returnType,
                                descriptorOf(parameterTypes, returnType));
                    }
                }
            }
        }
        return null;
    }

    private static String descriptorOf(KtNamedFunction function, ValueType returnType) {
        ValueType[] parameterTypes = new ValueType[function.getValueParameters().size()];
        for (int i = 0; i < parameterTypes.length; i++) {
            parameterTypes[i] = typeOf(function.getValueParameters().get(i));
        }
        return descriptorOf(parameterTypes, returnType);
    }

    private static String descriptorOf(ValueType[] parameterTypes, ValueType returnType) {
        StringBuilder descriptor = new StringBuilder();
        descriptor.append('(');
        for (ValueType parameterType : parameterTypes) {
            descriptor.append(parameterType.descriptor);
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
        if ("Long".equals(text)) {
            return ValueType.LONG;
        }
        if ("Double".equals(text)) {
            return ValueType.DOUBLE;
        }
        if ("String".equals(text)) {
            return ValueType.STRING;
        }
        if ("Char".equals(text)) {
            return ValueType.CHAR;
        }
        if ("Boolean".equals(text)) {
            return ValueType.BOOLEAN;
        }
        if ("IntArray".equals(text)) {
            return ValueType.INT_ARRAY;
        }
        if ("LongArray".equals(text)) {
            return ValueType.LONG_ARRAY;
        }
        if ("DoubleArray".equals(text)) {
            return ValueType.DOUBLE_ARRAY;
        }
        if ("CharArray".equals(text)) {
            return ValueType.CHAR_ARRAY;
        }
        if ("BooleanArray".equals(text)) {
            return ValueType.BOOLEAN_ARRAY;
        }
        if ("Unit".equals(text)) {
            return ValueType.VOID;
        }
        throw new IllegalArgumentException("Unsupported Kotlin type in browser probe emitter: " + text);
    }

    private static ValueType promotedNumericType(ValueType leftType, ValueType rightType) {
        if (leftType == ValueType.DOUBLE || rightType == ValueType.DOUBLE) {
            return ValueType.DOUBLE;
        }
        if (leftType == ValueType.LONG || rightType == ValueType.LONG) {
            return ValueType.LONG;
        }
        return ValueType.INT;
    }

    private static boolean isDoubleLiteralText(String text) {
        if (text == null || text.isEmpty()) {
            return false;
        }
        if (text.charAt(0) == '\'' || text.charAt(0) == '"') {
            return false;
        }
        return text.indexOf('.') >= 0 || text.indexOf('e') >= 0 || text.indexOf('E') >= 0;
    }

    private enum ValueType {
        INT("I", 1, true, false),
        LONG("J", 2, true, false),
        DOUBLE("D", 2, true, false),
        CHAR("C", 1, false, false),
        BOOLEAN("Z", 1, false, false),
        STRING("Ljava/lang/String;", 1, false, false),
        INT_ARRAY("[I", 1, false, true),
        LONG_ARRAY("[J", 1, false, true),
        DOUBLE_ARRAY("[D", 1, false, true),
        CHAR_ARRAY("[C", 1, false, true),
        BOOLEAN_ARRAY("[Z", 1, false, true),
        VOID("V", 0, false, false);

        private final String descriptor;
        private final int slots;
        private final boolean numeric;
        private final boolean array;

        ValueType(String descriptor, int slots, boolean numeric, boolean array) {
            this.descriptor = descriptor;
            this.slots = slots;
            this.numeric = numeric;
            this.array = array;
        }
    }

    private static final class FunctionSignature {
        private final ValueType[] parameterTypes;
        private final ValueType returnType;
        private final String descriptor;

        private FunctionSignature(ValueType[] parameterTypes, ValueType returnType, String descriptor) {
            this.parameterTypes = parameterTypes;
            this.returnType = returnType;
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
        private final ClassBuilder builder;
        private final String ownerInternalName;
        private final ValueType returnType;
        private final Map<String, Local> locals = new HashMap<>();
        private int nextLocal;
        private boolean hasExplicitReturn;

        private MethodContext(ClassBuilder builder, String ownerInternalName, ValueType returnType) {
            this.builder = builder;
            this.ownerInternalName = ownerInternalName;
            this.returnType = returnType;
        }

        private int allocate(String name, ValueType type) {
            int index = nextLocal;
            nextLocal += type.slots;
            locals.put(name, new Local(index, type));
            return index;
        }
    }
}
