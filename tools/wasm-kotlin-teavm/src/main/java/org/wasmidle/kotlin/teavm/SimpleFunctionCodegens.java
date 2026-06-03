package org.wasmidle.kotlin.teavm;

import com.intellij.psi.tree.IElementType;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
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
import org.jetbrains.kotlin.psi.KtBreakExpression;
import org.jetbrains.kotlin.psi.KtCallExpression;
import org.jetbrains.kotlin.psi.KtConstantExpression;
import org.jetbrains.kotlin.psi.KtContinueExpression;
import org.jetbrains.kotlin.psi.KtDeclaration;
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression;
import org.jetbrains.kotlin.psi.KtEscapeStringTemplateEntry;
import org.jetbrains.kotlin.psi.KtExpression;
import org.jetbrains.kotlin.psi.KtFile;
import org.jetbrains.kotlin.psi.KtForExpression;
import org.jetbrains.kotlin.psi.KtIfExpression;
import org.jetbrains.kotlin.psi.KtLambdaExpression;
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
import org.jetbrains.kotlin.psi.KtWhenCondition;
import org.jetbrains.kotlin.psi.KtWhenConditionWithExpression;
import org.jetbrains.kotlin.psi.KtWhenEntry;
import org.jetbrains.kotlin.psi.KtWhenExpression;
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
        if (statement instanceof KtForExpression) {
            emitForExpression(method, context, (KtForExpression) statement);
            return;
        }
        if (statement instanceof KtWhileExpression) {
            KtWhileExpression whileExpression = (KtWhileExpression) statement;
            Label startLabel = new Label();
            Label endLabel = new Label();
            method.visitLabel(startLabel);
            emitConditionJump(method, context, whileExpression.getCondition(), false, endLabel);
            context.loopLabels.push(new LoopLabels(endLabel, startLabel));
            emitBranch(method, context, whileExpression.getBody());
            context.loopLabels.pop();
            context.hasExplicitReturn = false;
            method.visitJumpInsn(Opcodes.GOTO, startLabel);
            method.visitLabel(endLabel);
            return;
        }
        if (statement instanceof KtBreakExpression) {
            if (context.loopLabels.isEmpty()) {
                throw new IllegalArgumentException("break is only supported inside loops: " + statement.getText());
            }
            method.visitJumpInsn(Opcodes.GOTO, context.loopLabels.peek().breakTarget);
            return;
        }
        if (statement instanceof KtContinueExpression) {
            if (context.loopLabels.isEmpty()) {
                throw new IllegalArgumentException("continue is only supported inside loops: " + statement.getText());
            }
            method.visitJumpInsn(Opcodes.GOTO, context.loopLabels.peek().continueTarget);
            return;
        }
        if (statement instanceof KtWhenExpression) {
            emitWhenStatement(method, context, (KtWhenExpression) statement);
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
        if (statement instanceof KtDotQualifiedExpression) {
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

    private static KtExpression singleLambdaResultExpression(KtLambdaExpression lambda, String callText) {
        KtExpression body = lambda.getBodyExpression();
        if (body instanceof KtBlockExpression) {
            List<KtExpression> statements = ((KtBlockExpression) body).getStatements();
            if (statements.size() == 1) {
                return statements.get(0);
            }
        } else if (body != null) {
            return body;
        }
        throw new IllegalArgumentException("Only single-expression lambda bodies are supported: " + callText);
    }

    private static String lambdaParameterName(KtLambdaExpression lambda, String defaultName, String callText) {
        List<KtParameter> parameters = lambda.getValueParameters();
        if (parameters.size() > 1) {
            throw new IllegalArgumentException("Lambda supports at most one parameter: " + callText);
        }
        if (parameters.isEmpty()) {
            return defaultName;
        }
        String parameterName = parameters.get(0).getName();
        if (parameterName == null || parameterName.isEmpty()) {
            throw new IllegalArgumentException("Unsupported unnamed lambda parameter: " + callText);
        }
        return parameterName;
    }

    private static ValueType arrayTypeForArrayInitializer(ValueType initializerType, String callText) {
        if (initializerType == ValueType.INT_ARRAY) {
            return ValueType.INT_2D_ARRAY;
        }
        if (initializerType == ValueType.LONG_ARRAY) {
            return ValueType.LONG_2D_ARRAY;
        }
        if (initializerType == ValueType.DOUBLE_ARRAY) {
            return ValueType.DOUBLE_2D_ARRAY;
        }
        if (initializerType == ValueType.CHAR_ARRAY) {
            return ValueType.CHAR_2D_ARRAY;
        }
        if (initializerType == ValueType.BOOLEAN_ARRAY) {
            return ValueType.BOOLEAN_2D_ARRAY;
        }
        throw new IllegalArgumentException("Array initializer must produce a primitive array: " + callText);
    }

    private static ValueType indexedElementType(ValueType arrayType) {
        if (arrayType == ValueType.INT_ARRAY) {
            return ValueType.INT;
        }
        if (arrayType == ValueType.LONG_ARRAY) {
            return ValueType.LONG;
        }
        if (arrayType == ValueType.DOUBLE_ARRAY) {
            return ValueType.DOUBLE;
        }
        if (arrayType == ValueType.CHAR_ARRAY || arrayType == ValueType.STRING) {
            return ValueType.CHAR;
        }
        if (arrayType == ValueType.BOOLEAN_ARRAY) {
            return ValueType.BOOLEAN;
        }
        if (arrayType == ValueType.INT_2D_ARRAY) {
            return ValueType.INT_ARRAY;
        }
        if (arrayType == ValueType.LONG_2D_ARRAY) {
            return ValueType.LONG_ARRAY;
        }
        if (arrayType == ValueType.DOUBLE_2D_ARRAY) {
            return ValueType.DOUBLE_ARRAY;
        }
        if (arrayType == ValueType.CHAR_2D_ARRAY) {
            return ValueType.CHAR_ARRAY;
        }
        if (arrayType == ValueType.BOOLEAN_2D_ARRAY) {
            return ValueType.BOOLEAN_ARRAY;
        }
        throw new IllegalArgumentException("Unsupported indexed type: " + arrayType);
    }

    private static void emitWhenStatement(MethodVisitor method, MethodContext context, KtWhenExpression expression) {
        KtExpression subjectExpression = expression.getSubjectExpression();
        ValueType subjectType = null;
        int subjectIndex = -1;
        if (subjectExpression != null) {
            subjectType = emitExpression(method, context, subjectExpression);
            subjectIndex = context.allocateTemporary(subjectType);
            storeLocal(method, subjectType, subjectIndex);
        }

        Label endLabel = new Label();
        for (KtWhenEntry entry : expression.getEntries()) {
            if (entry.isElse()) {
                emitBranch(method, context, entry.getExpression());
                context.hasExplicitReturn = false;
                break;
            }
            KtWhenCondition[] conditions = entry.getConditions();
            if (conditions.length == 0) {
                throw new IllegalArgumentException("when entry is missing conditions: " + entry.getText());
            }
            Label bodyLabel = new Label();
            Label nextLabel = new Label();
            for (KtWhenCondition condition : conditions) {
                emitWhenConditionJump(method, context, condition, subjectType, subjectIndex, bodyLabel);
            }
            method.visitJumpInsn(Opcodes.GOTO, nextLabel);
            method.visitLabel(bodyLabel);
            emitBranch(method, context, entry.getExpression());
            boolean entryReturned = context.hasExplicitReturn;
            context.hasExplicitReturn = false;
            if (!entryReturned) {
                method.visitJumpInsn(Opcodes.GOTO, endLabel);
            }
            method.visitLabel(nextLabel);
        }
        method.visitLabel(endLabel);
    }

    private static ValueType emitWhenExpression(
            MethodVisitor method, MethodContext context, KtWhenExpression expression) {
        ValueType resultType = inferWhenExpressionType(context, expression);
        KtExpression subjectExpression = expression.getSubjectExpression();
        ValueType subjectType = null;
        int subjectIndex = -1;
        if (subjectExpression != null) {
            subjectType = emitExpression(method, context, subjectExpression);
            subjectIndex = context.allocateTemporary(subjectType);
            storeLocal(method, subjectType, subjectIndex);
        }

        Label endLabel = new Label();
        for (KtWhenEntry entry : expression.getEntries()) {
            if (entry.isElse()) {
                emitExpressionAs(method, context, entry.getExpression(), resultType);
                method.visitJumpInsn(Opcodes.GOTO, endLabel);
                break;
            }
            KtWhenCondition[] conditions = entry.getConditions();
            if (conditions.length == 0) {
                throw new IllegalArgumentException("when entry is missing conditions: " + entry.getText());
            }
            Label bodyLabel = new Label();
            Label nextLabel = new Label();
            for (KtWhenCondition condition : conditions) {
                emitWhenConditionJump(method, context, condition, subjectType, subjectIndex, bodyLabel);
            }
            method.visitJumpInsn(Opcodes.GOTO, nextLabel);
            method.visitLabel(bodyLabel);
            emitExpressionAs(method, context, entry.getExpression(), resultType);
            method.visitJumpInsn(Opcodes.GOTO, endLabel);
            method.visitLabel(nextLabel);
        }
        method.visitLabel(endLabel);
        return resultType;
    }

    private static void emitWhenConditionJump(
            MethodVisitor method, MethodContext context, KtWhenCondition condition, ValueType subjectType,
            int subjectIndex, Label target) {
        if (!(condition instanceof KtWhenConditionWithExpression)) {
            throw new IllegalArgumentException("Only expression when conditions are supported: "
                    + condition.getText());
        }
        KtExpression conditionExpression = ((KtWhenConditionWithExpression) condition).getExpression();
        if (conditionExpression == null) {
            throw new IllegalArgumentException("when condition is missing an expression: " + condition.getText());
        }
        if (subjectType == null) {
            emitConditionJump(method, context, conditionExpression, true, target);
            return;
        }
        emitWhenSubjectEqualityJump(method, context, subjectType, subjectIndex, conditionExpression, target);
    }

    private static void emitWhenSubjectEqualityJump(
            MethodVisitor method, MethodContext context, ValueType subjectType, int subjectIndex,
            KtExpression conditionExpression, Label target) {
        ValueType conditionType = inferExpressionType(context, conditionExpression);
        if (subjectType == ValueType.STRING && conditionType == ValueType.STRING) {
            loadLocal(method, subjectType, subjectIndex);
            emitExpressionAs(method, context, conditionExpression, ValueType.STRING);
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "equals",
                    "(Ljava/lang/Object;)Z", false);
            method.visitJumpInsn(Opcodes.IFNE, target);
            return;
        }
        ValueType comparisonType;
        if (subjectType.numeric && conditionType.numeric) {
            comparisonType = promotedNumericType(subjectType, conditionType);
        } else if (subjectType == conditionType
                && (subjectType == ValueType.CHAR || subjectType == ValueType.BOOLEAN)) {
            comparisonType = subjectType;
        } else {
            throw new IllegalArgumentException("when condition type mismatch: " + conditionExpression.getText());
        }
        emitLocalAs(method, subjectType, subjectIndex, comparisonType);
        emitExpressionAs(method, context, conditionExpression, comparisonType);
        if (comparisonType == ValueType.LONG) {
            method.visitInsn(Opcodes.LCMP);
            method.visitJumpInsn(Opcodes.IFEQ, target);
        } else if (comparisonType == ValueType.DOUBLE) {
            method.visitInsn(Opcodes.DCMPL);
            method.visitJumpInsn(Opcodes.IFEQ, target);
        } else {
            method.visitJumpInsn(Opcodes.IF_ICMPEQ, target);
        }
    }

    private static void emitLocalAs(
            MethodVisitor method, ValueType actualType, int index, ValueType expectedType) {
        loadLocal(method, actualType, index);
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
        throw new IllegalArgumentException("Local type mismatch: expected " + expectedType
                + ", got " + actualType);
    }

    private static void emitForExpression(MethodVisitor method, MethodContext context, KtForExpression expression) {
        if (expression.getLoopParameter() == null || expression.getLoopRange() == null) {
            throw new IllegalArgumentException("Unsupported for-loop shape: " + expression.getText());
        }
        String parameterName = expression.getLoopParameter().getName();
        if (parameterName == null || parameterName.isEmpty()) {
            throw new IllegalArgumentException("Unsupported unnamed for-loop parameter: " + expression.getText());
        }
        ForProgression progression = parseForProgression(expression.getLoopRange());
        int loopIndex = context.allocate(parameterName, ValueType.INT);
        emitExpressionAs(method, context, progression.start, ValueType.INT);
        method.visitVarInsn(Opcodes.ISTORE, loopIndex);
        int endIndex = context.allocateTemporary(ValueType.INT);
        emitExpressionAs(method, context, progression.end, ValueType.INT);
        method.visitVarInsn(Opcodes.ISTORE, endIndex);
        int stepIndex = context.allocateTemporary(ValueType.INT);
        if (progression.step == null) {
            method.visitInsn(Opcodes.ICONST_1);
        } else {
            emitExpressionAs(method, context, progression.step, ValueType.INT);
        }
        method.visitVarInsn(Opcodes.ISTORE, stepIndex);

        Label startLabel = new Label();
        Label updateLabel = new Label();
        Label endLabel = new Label();
        method.visitLabel(startLabel);
        method.visitVarInsn(Opcodes.ILOAD, loopIndex);
        method.visitVarInsn(Opcodes.ILOAD, endIndex);
        if (progression.descending) {
            method.visitJumpInsn(Opcodes.IF_ICMPLT, endLabel);
        } else if (progression.inclusive) {
            method.visitJumpInsn(Opcodes.IF_ICMPGT, endLabel);
        } else {
            method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
        }
        context.loopLabels.push(new LoopLabels(endLabel, updateLabel));
        emitBranch(method, context, expression.getBody());
        context.loopLabels.pop();
        context.hasExplicitReturn = false;
        method.visitLabel(updateLabel);
        method.visitVarInsn(Opcodes.ILOAD, loopIndex);
        method.visitVarInsn(Opcodes.ILOAD, stepIndex);
        method.visitInsn(progression.descending ? Opcodes.ISUB : Opcodes.IADD);
        method.visitVarInsn(Opcodes.ISTORE, loopIndex);
        method.visitJumpInsn(Opcodes.GOTO, startLabel);
        method.visitLabel(endLabel);
    }

    private static boolean emitAssignment(MethodVisitor method, MethodContext context, KtBinaryExpression binary) {
        IElementType operation = binary.getOperationToken();
        KtExpression left = binary.getLeft();
        KtExpression right = binary.getRight();
        if (right == null) {
            return false;
        }
        if (left instanceof KtArrayAccessExpression) {
            ValueType arrayType = emitArrayReferenceAndIndex(method, context, (KtArrayAccessExpression) left);
            if (operation != KtTokens.EQ) {
                if (!isCompoundAssignment(operation)) {
                    throw new IllegalArgumentException("Unsupported array assignment: " + binary.getText());
                }
                return emitArrayCompoundAssignment(method, context, binary, arrayType, right);
            }
            ValueType elementType = indexedElementType(arrayType);
            ValueType valueType = emitExpression(method, context, right);
            if (elementType == ValueType.INT && valueType == ValueType.INT) {
                method.visitInsn(Opcodes.IASTORE);
                return true;
            }
            if (elementType == ValueType.LONG && valueType == ValueType.LONG) {
                method.visitInsn(Opcodes.LASTORE);
                return true;
            }
            if (elementType == ValueType.DOUBLE && valueType == ValueType.DOUBLE) {
                method.visitInsn(Opcodes.DASTORE);
                return true;
            }
            if (elementType == ValueType.CHAR && valueType == ValueType.CHAR) {
                method.visitInsn(Opcodes.CASTORE);
                return true;
            }
            if (elementType == ValueType.BOOLEAN && valueType == ValueType.BOOLEAN) {
                method.visitInsn(Opcodes.BASTORE);
                return true;
            }
            if (elementType.array && valueType == elementType) {
                method.visitInsn(Opcodes.AASTORE);
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

    private static boolean emitArrayCompoundAssignment(
            MethodVisitor method, MethodContext context, KtBinaryExpression binary, ValueType arrayType,
            KtExpression right) {
        ValueType elementType;
        int loadOpcode;
        int storeOpcode;
        if (arrayType == ValueType.INT_ARRAY) {
            elementType = ValueType.INT;
            loadOpcode = Opcodes.IALOAD;
            storeOpcode = Opcodes.IASTORE;
        } else if (arrayType == ValueType.LONG_ARRAY) {
            elementType = ValueType.LONG;
            loadOpcode = Opcodes.LALOAD;
            storeOpcode = Opcodes.LASTORE;
        } else if (arrayType == ValueType.DOUBLE_ARRAY) {
            elementType = ValueType.DOUBLE;
            loadOpcode = Opcodes.DALOAD;
            storeOpcode = Opcodes.DASTORE;
        } else {
            throw new IllegalArgumentException("Array compound assignment only supports numeric arrays: "
                    + binary.getText());
        }
        method.visitInsn(Opcodes.DUP2);
        method.visitInsn(loadOpcode);
        emitExpressionAs(method, context, right, elementType);
        emitArithmeticOpcode(method, binary.getOperationToken(), elementType);
        method.visitInsn(storeOpcode);
        return true;
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
                if (type == ValueType.LONG) {
                    method.visitInsn(Opcodes.LNEG);
                } else if (type == ValueType.DOUBLE) {
                    method.visitInsn(Opcodes.DNEG);
                } else {
                    method.visitInsn(Opcodes.INEG);
                }
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
            if (arrayType == ValueType.STRING) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "charAt", "(I)C", false);
                return ValueType.CHAR;
            }
            ValueType elementType = indexedElementType(arrayType);
            if (elementType == ValueType.INT) {
                method.visitInsn(Opcodes.IALOAD);
                return ValueType.INT;
            }
            if (elementType == ValueType.LONG) {
                method.visitInsn(Opcodes.LALOAD);
                return ValueType.LONG;
            }
            if (elementType == ValueType.DOUBLE) {
                method.visitInsn(Opcodes.DALOAD);
                return ValueType.DOUBLE;
            }
            if (elementType == ValueType.CHAR) {
                method.visitInsn(Opcodes.CALOAD);
                return ValueType.CHAR;
            }
            if (elementType == ValueType.BOOLEAN) {
                method.visitInsn(Opcodes.BALOAD);
                return ValueType.BOOLEAN;
            }
            if (elementType.array) {
                method.visitInsn(Opcodes.AALOAD);
                return elementType;
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
                if (callee != null && ("toInt".equals(callee.getText()) || "toLong".equals(callee.getText())
                        || "toDouble".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.STRING) {
                        if ("toInt".equals(callee.getText())) {
                            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Integer", "parseInt",
                                    "(Ljava/lang/String;)I", false);
                            return ValueType.INT;
                        }
                        if ("toLong".equals(callee.getText())) {
                            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Long", "parseLong",
                                    "(Ljava/lang/String;)J", false);
                            return ValueType.LONG;
                        }
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Double", "parseDouble",
                                "(Ljava/lang/String;)D", false);
                        return ValueType.DOUBLE;
                    }
                }
                if (callee != null && "sort".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY) {
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Arrays", "sort",
                                "(" + receiverType.descriptor + ")V", false);
                        return ValueType.VOID;
                    }
                }
                if (callee != null && "append".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.STRING_BUILDER) {
                        ValueType argumentType = emitExpression(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression());
                        String descriptor;
                        if (argumentType == ValueType.INT) {
                            descriptor = "(I)Ljava/lang/StringBuilder;";
                        } else if (argumentType == ValueType.LONG) {
                            descriptor = "(J)Ljava/lang/StringBuilder;";
                        } else if (argumentType == ValueType.DOUBLE) {
                            descriptor = "(D)Ljava/lang/StringBuilder;";
                        } else if (argumentType == ValueType.CHAR) {
                            descriptor = "(C)Ljava/lang/StringBuilder;";
                        } else if (argumentType == ValueType.BOOLEAN) {
                            descriptor = "(Z)Ljava/lang/StringBuilder;";
                        } else if (argumentType == ValueType.STRING) {
                            descriptor = "(Ljava/lang/String;)Ljava/lang/StringBuilder;";
                        } else {
                            throw new IllegalArgumentException("Unsupported StringBuilder.append type: "
                                    + selector.getText());
                        }
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                                descriptor, false);
                        return ValueType.STRING_BUILDER;
                    }
                }
                if (callee != null && "toString".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.STRING_BUILDER) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "toString",
                                "()Ljava/lang/String;", false);
                        return ValueType.STRING;
                    }
                }
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
        if (expression instanceof KtWhenExpression) {
            return emitWhenExpression(method, context, (KtWhenExpression) expression);
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
        List<KtValueArgument> parenthesizedArguments = call.getValueArgumentList() == null
                ? Collections.emptyList()
                : call.getValueArgumentList().getArguments();
        if ("Array".equals(calleeText) && parenthesizedArguments.size() == 1
                && call.getLambdaArguments().size() == 1) {
            KtExpression countExpression = parenthesizedArguments.get(0).getArgumentExpression();
            if (countExpression == null) {
                throw new IllegalArgumentException("Array size is missing: " + call.getText());
            }
            ValueType countType = emitExpression(method, context, countExpression);
            if (countType != ValueType.INT) {
                throw new IllegalArgumentException("Array size must be Int: " + call.getText());
            }
            int countIndex = context.allocateTemporary(ValueType.INT);
            method.visitVarInsn(Opcodes.ISTORE, countIndex);
            int loopIndex = context.allocateTemporary(ValueType.INT);
            KtLambdaExpression lambda = call.getLambdaArguments().get(0).getLambdaExpression();
            String parameterName = lambdaParameterName(lambda, "it", call.getText());
            Local previousLocal = context.locals.get(parameterName);
            context.locals.put(parameterName, new Local(loopIndex, ValueType.INT));
            KtExpression initializer = singleLambdaResultExpression(lambda, call.getText());
            ValueType initializerType = inferExpressionType(context, initializer);
            ValueType arrayType = arrayTypeForArrayInitializer(initializerType, call.getText());
            method.visitVarInsn(Opcodes.ILOAD, countIndex);
            method.visitTypeInsn(Opcodes.ANEWARRAY, indexedElementType(arrayType).descriptor);
            int arrayIndex = context.allocateTemporary(arrayType);
            method.visitVarInsn(Opcodes.ASTORE, arrayIndex);
            method.visitInsn(Opcodes.ICONST_0);
            method.visitVarInsn(Opcodes.ISTORE, loopIndex);

            Label startLabel = new Label();
            Label endLabel = new Label();
            method.visitLabel(startLabel);
            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
            method.visitVarInsn(Opcodes.ILOAD, countIndex);
            method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
            method.visitVarInsn(Opcodes.ALOAD, arrayIndex);
            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
            emitExpressionAs(method, context, initializer, initializerType);
            method.visitInsn(Opcodes.AASTORE);
            method.visitIincInsn(loopIndex, 1);
            method.visitJumpInsn(Opcodes.GOTO, startLabel);
            method.visitLabel(endLabel);
            method.visitVarInsn(Opcodes.ALOAD, arrayIndex);
            if (previousLocal == null) {
                context.locals.remove(parameterName);
            } else {
                context.locals.put(parameterName, previousLocal);
            }
            return arrayType;
        }
        if ("repeat".equals(calleeText) && parenthesizedArguments.size() == 1
                && call.getLambdaArguments().size() == 1) {
            KtExpression countExpression = parenthesizedArguments.get(0).getArgumentExpression();
            if (countExpression == null) {
                throw new IllegalArgumentException("repeat count is missing: " + call.getText());
            }
            ValueType countType = emitExpression(method, context, countExpression);
            if (countType != ValueType.INT) {
                throw new IllegalArgumentException("repeat count must be Int: " + call.getText());
            }
            int countIndex = context.allocateTemporary(ValueType.INT);
            method.visitVarInsn(Opcodes.ISTORE, countIndex);
            int loopIndex = context.allocateTemporary(ValueType.INT);
            method.visitInsn(Opcodes.ICONST_0);
            method.visitVarInsn(Opcodes.ISTORE, loopIndex);

            KtLambdaExpression lambda = call.getLambdaArguments().get(0).getLambdaExpression();
            String parameterName = lambdaParameterName(lambda, "it", call.getText());
            Local previousLocal = context.locals.get(parameterName);
            context.locals.put(parameterName, new Local(loopIndex, ValueType.INT));

            Label startLabel = new Label();
            Label updateLabel = new Label();
            Label endLabel = new Label();
            method.visitLabel(startLabel);
            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
            method.visitVarInsn(Opcodes.ILOAD, countIndex);
            method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
            context.loopLabels.push(new LoopLabels(endLabel, updateLabel));
            emitBranch(method, context, lambda.getBodyExpression());
            context.loopLabels.pop();
            context.hasExplicitReturn = false;
            method.visitLabel(updateLabel);
            method.visitIincInsn(loopIndex, 1);
            method.visitJumpInsn(Opcodes.GOTO, startLabel);
            method.visitLabel(endLabel);
            if (previousLocal == null) {
                context.locals.remove(parameterName);
            } else {
                context.locals.put(parameterName, previousLocal);
            }
            return ValueType.VOID;
        }
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
        if ("StringBuilder".equals(calleeText) && call.getValueArguments().isEmpty()) {
            method.visitTypeInsn(Opcodes.NEW, "java/lang/StringBuilder");
            method.visitInsn(Opcodes.DUP);
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
            return ValueType.STRING_BUILDER;
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
            if (arrayExpression == null) {
                throw new IllegalArgumentException("Missing array expression: " + expression.getText());
            }
            ValueType arrayType = inferExpressionType(context, arrayExpression);
            if (!arrayType.array && arrayType != ValueType.STRING) {
                throw new IllegalArgumentException("Unsupported array type: " + expression.getText());
            }
            return indexedElementType(arrayType);
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
                if (callee != null && ("toInt".equals(callee.getText()) || "toLong".equals(callee.getText())
                        || "toDouble".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()
                        && inferExpressionType(context, qualified.getReceiverExpression()) == ValueType.STRING) {
                    if ("toInt".equals(callee.getText())) {
                        return ValueType.INT;
                    }
                    if ("toLong".equals(callee.getText())) {
                        return ValueType.LONG;
                    }
                    return ValueType.DOUBLE;
                }
                if (callee != null && "sort".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY) {
                        return ValueType.VOID;
                    }
                }
                if (callee != null && "append".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1
                        && inferExpressionType(context, qualified.getReceiverExpression())
                                == ValueType.STRING_BUILDER) {
                    return ValueType.STRING_BUILDER;
                }
                if (callee != null && "toString".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()
                        && inferExpressionType(context, qualified.getReceiverExpression())
                                == ValueType.STRING_BUILDER) {
                    return ValueType.STRING;
                }
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
        if (expression instanceof KtWhenExpression) {
            return inferWhenExpressionType(context, (KtWhenExpression) expression);
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
            if ("Array".equals(calleeText)) {
                List<KtValueArgument> parenthesizedArguments = ((KtCallExpression) expression)
                        .getValueArgumentList() == null
                        ? Collections.emptyList()
                        : ((KtCallExpression) expression).getValueArgumentList().getArguments();
                if (parenthesizedArguments.size() == 1
                        && ((KtCallExpression) expression).getLambdaArguments().size() == 1) {
                    KtLambdaExpression lambda = ((KtCallExpression) expression).getLambdaArguments()
                            .get(0).getLambdaExpression();
                    String parameterName = lambdaParameterName(lambda, "it", expression.getText());
                    Local previousLocal = context.locals.get(parameterName);
                    context.locals.put(parameterName, new Local(-1, ValueType.INT));
                    try {
                        ValueType initializerType = inferExpressionType(context,
                                singleLambdaResultExpression(lambda, expression.getText()));
                        return arrayTypeForArrayInitializer(initializerType, expression.getText());
                    } finally {
                        if (previousLocal == null) {
                            context.locals.remove(parameterName);
                        } else {
                            context.locals.put(parameterName, previousLocal);
                        }
                    }
                }
            }
            if ("StringBuilder".equals(calleeText)) {
                return ValueType.STRING_BUILDER;
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

    private static ValueType inferWhenExpressionType(MethodContext context, KtWhenExpression expression) {
        ValueType resultType = null;
        boolean hasElse = false;
        for (KtWhenEntry entry : expression.getEntries()) {
            if (entry.isElse()) {
                hasElse = true;
            }
            KtExpression entryExpression = entry.getExpression();
            if (entryExpression == null) {
                throw new IllegalArgumentException("when entry is missing a result expression: "
                        + entry.getText());
            }
            ValueType entryType = inferExpressionType(context, entryExpression);
            if (resultType == null) {
                resultType = entryType;
            } else if (resultType.numeric && entryType.numeric) {
                resultType = promotedNumericType(resultType, entryType);
            } else if (resultType != entryType) {
                throw new IllegalArgumentException("when expression branches have different types: "
                        + expression.getText());
            }
        }
        if (!hasElse) {
            throw new IllegalArgumentException("when expression requires an else branch: "
                    + expression.getText());
        }
        if (resultType == null) {
            throw new IllegalArgumentException("when expression has no entries: " + expression.getText());
        }
        return resultType;
    }

    private static ValueType emitArrayReferenceAndIndex(
            MethodVisitor method, MethodContext context, KtArrayAccessExpression expression) {
        KtExpression arrayExpression = expression.getArrayExpression();
        if (arrayExpression == null || expression.getIndexExpressions().size() != 1) {
            throw new IllegalArgumentException("Only one-dimensional index expressions are supported: "
                    + expression.getText());
        }
        ValueType arrayType;
        if (arrayExpression instanceof KtNameReferenceExpression) {
            Local local = context.locals.get(arrayExpression.getText());
            if (local == null || (!local.type.array && local.type != ValueType.STRING)) {
                throw new IllegalArgumentException("Unknown array local: " + arrayExpression.getText());
            }
            method.visitVarInsn(Opcodes.ALOAD, local.index);
            arrayType = local.type;
        } else {
            arrayType = emitExpression(method, context, arrayExpression);
            if (!arrayType.array && arrayType != ValueType.STRING) {
                throw new IllegalArgumentException("Unsupported array expression: " + arrayExpression.getText());
            }
        }
        ValueType indexType = emitExpression(method, context, expression.getIndexExpressions().get(0));
        if (indexType != ValueType.INT) {
            throw new IllegalArgumentException("Array index must be Int: " + expression.getText());
        }
        return arrayType;
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

    private static boolean isCompoundAssignment(IElementType operation) {
        return operation == KtTokens.PLUSEQ || operation == KtTokens.MINUSEQ
                || operation == KtTokens.MULTEQ || operation == KtTokens.DIVEQ
                || operation == KtTokens.PERCEQ;
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
        } else if (returnType == ValueType.STRING_BUILDER) {
            method.visitInsn(Opcodes.ACONST_NULL);
            method.visitInsn(Opcodes.ARETURN);
        } else if (returnType == ValueType.INT_ARRAY || returnType == ValueType.LONG_ARRAY
                || returnType == ValueType.DOUBLE_ARRAY || returnType == ValueType.CHAR_ARRAY
                || returnType == ValueType.BOOLEAN_ARRAY || returnType == ValueType.INT_2D_ARRAY
                || returnType == ValueType.LONG_2D_ARRAY || returnType == ValueType.DOUBLE_2D_ARRAY
                || returnType == ValueType.CHAR_2D_ARRAY || returnType == ValueType.BOOLEAN_2D_ARRAY) {
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
        if ("StringBuilder".equals(text)) {
            return ValueType.STRING_BUILDER;
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
        if ("Array<IntArray>".equals(text)) {
            return ValueType.INT_2D_ARRAY;
        }
        if ("Array<LongArray>".equals(text)) {
            return ValueType.LONG_2D_ARRAY;
        }
        if ("Array<DoubleArray>".equals(text)) {
            return ValueType.DOUBLE_2D_ARRAY;
        }
        if ("Array<CharArray>".equals(text)) {
            return ValueType.CHAR_2D_ARRAY;
        }
        if ("Array<BooleanArray>".equals(text)) {
            return ValueType.BOOLEAN_2D_ARRAY;
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

    private static ForProgression parseForProgression(KtExpression expression) {
        if (expression instanceof KtParenthesizedExpression) {
            return parseForProgression(((KtParenthesizedExpression) expression).getExpression());
        }
        if (!(expression instanceof KtBinaryExpression)) {
            throw new IllegalArgumentException("Unsupported for-loop range: " + expression.getText());
        }
        KtBinaryExpression binary = (KtBinaryExpression) expression;
        String operation = binary.getOperationReference().getText();
        if ("step".equals(operation)) {
            ForProgression base = parseForProgression(binary.getLeft());
            if (binary.getRight() == null) {
                throw new IllegalArgumentException("Missing step expression: " + expression.getText());
            }
            return new ForProgression(base.start, base.end, base.inclusive, base.descending, binary.getRight());
        }
        if ("until".equals(operation) || "..<".equals(operation)) {
            return new ForProgression(binary.getLeft(), binary.getRight(), false, false, null);
        }
        if ("..".equals(operation)) {
            return new ForProgression(binary.getLeft(), binary.getRight(), true, false, null);
        }
        if ("downTo".equals(operation)) {
            return new ForProgression(binary.getLeft(), binary.getRight(), true, true, null);
        }
        throw new IllegalArgumentException("Unsupported for-loop range operation: " + expression.getText());
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
        STRING_BUILDER("Ljava/lang/StringBuilder;", 1, false, false),
        INT_ARRAY("[I", 1, false, true),
        LONG_ARRAY("[J", 1, false, true),
        DOUBLE_ARRAY("[D", 1, false, true),
        CHAR_ARRAY("[C", 1, false, true),
        BOOLEAN_ARRAY("[Z", 1, false, true),
        INT_2D_ARRAY("[[I", 1, false, true),
        LONG_2D_ARRAY("[[J", 1, false, true),
        DOUBLE_2D_ARRAY("[[D", 1, false, true),
        CHAR_2D_ARRAY("[[C", 1, false, true),
        BOOLEAN_2D_ARRAY("[[Z", 1, false, true),
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

    private static final class ForProgression {
        private final KtExpression start;
        private final KtExpression end;
        private final boolean inclusive;
        private final boolean descending;
        private final KtExpression step;

        private ForProgression(
                KtExpression start, KtExpression end, boolean inclusive, boolean descending, KtExpression step) {
            if (start == null || end == null) {
                throw new IllegalArgumentException("For-loop range is missing a bound");
            }
            this.start = start;
            this.end = end;
            this.inclusive = inclusive;
            this.descending = descending;
            this.step = step;
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

    private static final class LoopLabels {
        private final Label breakTarget;
        private final Label continueTarget;

        private LoopLabels(Label breakTarget, Label continueTarget) {
            this.breakTarget = breakTarget;
            this.continueTarget = continueTarget;
        }
    }

    private static final class MethodContext {
        private final ClassBuilder builder;
        private final String ownerInternalName;
        private final ValueType returnType;
        private final Map<String, Local> locals = new HashMap<>();
        private final Deque<LoopLabels> loopLabels = new ArrayDeque<>();
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

        private int allocateTemporary(ValueType type) {
            int index = nextLocal;
            nextLocal += type.slots;
            return index;
        }
    }
}
