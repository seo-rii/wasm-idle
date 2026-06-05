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
import org.jetbrains.kotlin.psi.KtDestructuringDeclaration;
import org.jetbrains.kotlin.psi.KtDestructuringDeclarationEntry;
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
        if (statement instanceof KtDestructuringDeclaration) {
            KtDestructuringDeclaration declaration = (KtDestructuringDeclaration) statement;
            KtExpression initializer = declaration.getInitializer();
            List<KtDestructuringDeclarationEntry> entries = declaration.getEntries();
            if (initializer == null || entries.size() != 2) {
                throw new IllegalArgumentException("Only Pair destructuring declarations are supported: "
                        + declaration.getText());
            }
            ValueType pairType = emitExpression(method, context, initializer);
            if (!isPairType(pairType)) {
                throw new IllegalArgumentException("Destructuring requires a Pair value: " + declaration.getText());
            }
            int pairIndex = context.allocateTemporary(pairType);
            storeLocal(method, pairType, pairIndex);
            for (int entryIndex = 0; entryIndex < entries.size(); entryIndex++) {
                KtDestructuringDeclarationEntry entry = entries.get(entryIndex);
                String entryName = entry.getName();
                if (entryName == null || entryName.isEmpty() || "_".equals(entryName)) {
                    continue;
                }
                ValueType componentType = pairComponentType(pairType, entryIndex);
                emitPairComponent(method, pairType, pairIndex, entryIndex);
                int index = context.allocate(entryName, componentType);
                storeLocal(method, componentType, index);
            }
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
        PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(initializerType);
        if (primitiveShape != null) {
            return primitiveShape.arrayArrayType;
        }
        if (initializerType == ValueType.INT_ARRAY_LIST) {
            return ValueType.INT_ARRAY_LIST_ARRAY;
        }
        if (isPairArrayListType(initializerType)) {
            return arrayTypeForPairArrayList(initializerType);
        }
        throw new IllegalArgumentException("Unsupported Array initializer type: " + callText);
    }

    private static PrimitiveArrayShape primitiveArrayShapeForConstructor(String calleeText) {
        return primitiveArrayShapeFromKotlinType(calleeText);
    }

    private static ValueType indexedElementType(ValueType arrayType) {
        if (arrayType == ValueType.STRING) {
            return ValueType.CHAR;
        }
        PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(arrayType);
        if (primitiveShape != null) {
            return primitiveShape.elementType;
        }
        primitiveShape = primitiveArrayShapeForArrayArrayType(arrayType);
        if (primitiveShape != null) {
            return primitiveShape.arrayType;
        }
        if (arrayType == ValueType.INT_ARRAY_LIST_ARRAY) {
            return ValueType.INT_ARRAY_LIST;
        }
        if (isPairArrayListArrayType(arrayType)) {
            return arrayListTypeForPairArrayListArray(arrayType);
        }
        throw new IllegalArgumentException("Unsupported indexed type: " + arrayType);
    }

    private static String anewArrayComponentType(ValueType elementType) {
        if (elementType.descriptor.startsWith("L") && elementType.descriptor.endsWith(";")) {
            return elementType.descriptor.substring(1, elementType.descriptor.length() - 1);
        }
        return elementType.descriptor;
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
        if (expression.getLoopRange() == null) {
            throw new IllegalArgumentException("Unsupported for-loop shape: " + expression.getText());
        }
        KtDestructuringDeclaration destructuringDeclaration = expression.getDestructuringDeclaration();
        if (destructuringDeclaration != null) {
            ValueType rangeType = inferExpressionType(context, expression.getLoopRange());
            if (!isForEachRangeType(rangeType)) {
                throw new IllegalArgumentException("Unsupported destructuring for-loop range: "
                        + expression.getLoopRange().getText());
            }
            emitForEachExpression(method, context, expression, rangeType);
            return;
        }
        if (expression.getLoopParameter() == null) {
            throw new IllegalArgumentException("Unsupported for-loop shape: " + expression.getText());
        }
        String parameterName = expression.getLoopParameter().getName();
        if (parameterName == null || parameterName.isEmpty()) {
            throw new IllegalArgumentException("Unsupported unnamed for-loop parameter: " + expression.getText());
        }
        try {
            ValueType rangeType = inferExpressionType(context, expression.getLoopRange());
            if (isForEachRangeType(rangeType)) {
                emitForEachExpression(method, context, expression, rangeType);
                return;
            }
        } catch (IllegalArgumentException ignored) {
            // Progression loops such as arr.indices are parsed below.
        }
        ForProgression progression = parseForProgression(expression.getLoopRange());
        int loopIndex = context.allocate(parameterName, ValueType.INT);
        if (progression.indicesReceiver == null) {
            emitExpressionAs(method, context, progression.start, ValueType.INT);
        } else {
            method.visitInsn(Opcodes.ICONST_0);
        }
        method.visitVarInsn(Opcodes.ISTORE, loopIndex);
        int endIndex = context.allocateTemporary(ValueType.INT);
        if (progression.indicesReceiver == null) {
            emitExpressionAs(method, context, progression.end, ValueType.INT);
        } else {
            ValueType receiverType = emitExpression(method, context, progression.indicesReceiver);
            if (receiverType.array) {
                method.visitInsn(Opcodes.ARRAYLENGTH);
            } else if (receiverType == ValueType.STRING) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length", "()I", false);
            } else if (isArrayListType(receiverType)) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "size", "()I", false);
            } else {
                throw new IllegalArgumentException("Unsupported indices receiver: "
                        + progression.indicesReceiver.getText());
            }
        }
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

    private static void emitForEachExpression(
            MethodVisitor method, MethodContext context, KtForExpression expression, ValueType rangeType) {
        KtExpression loopRange = expression.getLoopRange();
        if (loopRange == null) {
            throw new IllegalArgumentException("Missing for-loop range: " + expression.getText());
        }
        ValueType emittedRangeType = emitExpression(method, context, loopRange);
        if (emittedRangeType != rangeType) {
            throw new IllegalArgumentException("For-loop range type changed: " + expression.getText());
        }
        int rangeIndex = context.allocateTemporary(rangeType);
        storeLocal(method, rangeType, rangeIndex);
        ValueType elementType = forEachElementType(rangeType);
        KtDestructuringDeclaration destructuringDeclaration = expression.getDestructuringDeclaration();
        int elementIndex = -1;
        int valueIndex = -1;
        int[] componentIndexes = null;
        if (destructuringDeclaration != null) {
            if (!isPairType(elementType)) {
                throw new IllegalArgumentException("Destructuring for-loop requires Pair elements: "
                        + expression.getText());
            }
            List<KtDestructuringDeclarationEntry> entries = destructuringDeclaration.getEntries();
            if (entries.size() != 2) {
                throw new IllegalArgumentException("Only Pair destructuring for-loops are supported: "
                        + expression.getText());
            }
            elementIndex = context.allocateTemporary(elementType);
            componentIndexes = new int[entries.size()];
            for (int entryIndex = 0; entryIndex < entries.size(); entryIndex++) {
                KtDestructuringDeclarationEntry entry = entries.get(entryIndex);
                String entryName = entry.getName();
                if (entryName == null || entryName.isEmpty() || "_".equals(entryName)) {
                    componentIndexes[entryIndex] = -1;
                } else {
                    componentIndexes[entryIndex] = context.allocate(entryName,
                            pairComponentType(elementType, entryIndex));
                }
            }
        } else {
            KtParameter loopParameter = expression.getLoopParameter();
            if (loopParameter == null) {
                throw new IllegalArgumentException("Missing for-loop parameter: " + expression.getText());
            }
            String parameterName = loopParameter.getName();
            if (parameterName == null || parameterName.isEmpty()) {
                throw new IllegalArgumentException("Unsupported unnamed for-loop parameter: "
                        + expression.getText());
            }
            valueIndex = context.allocate(parameterName, elementType);
        }
        int loopIndex = context.allocateTemporary(ValueType.INT);
        method.visitInsn(Opcodes.ICONST_0);
        method.visitVarInsn(Opcodes.ISTORE, loopIndex);
        int endIndex = context.allocateTemporary(ValueType.INT);
        loadLocal(method, rangeType, rangeIndex);
        if (rangeType.array) {
            method.visitInsn(Opcodes.ARRAYLENGTH);
        } else if (rangeType == ValueType.STRING) {
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length", "()I", false);
        } else {
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "size", "()I", false);
        }
        method.visitVarInsn(Opcodes.ISTORE, endIndex);

        Label startLabel = new Label();
        Label updateLabel = new Label();
        Label endLabel = new Label();
        method.visitLabel(startLabel);
        method.visitVarInsn(Opcodes.ILOAD, loopIndex);
        method.visitVarInsn(Opcodes.ILOAD, endIndex);
        method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
        emitForEachElement(method, rangeType, rangeIndex, loopIndex);
        if (destructuringDeclaration != null) {
            storeLocal(method, elementType, elementIndex);
            for (int entryIndex = 0; entryIndex < componentIndexes.length; entryIndex++) {
                if (componentIndexes[entryIndex] < 0) {
                    continue;
                }
                ValueType componentType = pairComponentType(elementType, entryIndex);
                emitPairComponent(method, elementType, elementIndex, entryIndex);
                storeLocal(method, componentType, componentIndexes[entryIndex]);
            }
        } else {
            storeLocal(method, elementType, valueIndex);
        }
        context.loopLabels.push(new LoopLabels(endLabel, updateLabel));
        emitBranch(method, context, expression.getBody());
        context.loopLabels.pop();
        context.hasExplicitReturn = false;
        method.visitLabel(updateLabel);
        method.visitVarInsn(Opcodes.ILOAD, loopIndex);
        method.visitInsn(Opcodes.ICONST_1);
        method.visitInsn(Opcodes.IADD);
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
            if (isHashMapType(arrayType)) {
                if (operation != KtTokens.EQ) {
                    throw new IllegalArgumentException("Map compound assignment is not supported: "
                            + binary.getText());
                }
                emitBoxedExpressionAs(method, context, right, hashMapValueType(arrayType));
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/HashMap", "put",
                        "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;", false);
                method.visitInsn(Opcodes.POP);
                return true;
            }
            if (arrayType == ValueType.INT_ARRAY_LIST) {
                if (operation != KtTokens.EQ) {
                    throw new IllegalArgumentException("List compound assignment is not supported: "
                            + binary.getText());
                }
                emitExpressionAs(method, context, right, ValueType.INT);
                boxInt(method);
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "set",
                        "(ILjava/lang/Object;)Ljava/lang/Object;", false);
                method.visitInsn(Opcodes.POP);
                return true;
            }
            if (arrayType == ValueType.LONG_ARRAY_LIST) {
                if (operation != KtTokens.EQ) {
                    throw new IllegalArgumentException("Long list compound assignment is not supported: "
                            + binary.getText());
                }
                emitExpressionAs(method, context, right, ValueType.LONG);
                boxLong(method);
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "set",
                        "(ILjava/lang/Object;)Ljava/lang/Object;", false);
                method.visitInsn(Opcodes.POP);
                return true;
            }
            if (arrayType == ValueType.STRING_ARRAY_LIST) {
                if (operation != KtTokens.EQ) {
                    throw new IllegalArgumentException("String list compound assignment is not supported: "
                            + binary.getText());
                }
                emitExpressionAs(method, context, right, ValueType.STRING);
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "set",
                        "(ILjava/lang/Object;)Ljava/lang/Object;", false);
                method.visitInsn(Opcodes.POP);
                return true;
            }
            if (isPairArrayListType(arrayType)) {
                if (operation != KtTokens.EQ) {
                    throw new IllegalArgumentException("Pair list compound assignment is not supported: "
                            + binary.getText());
                }
                emitExpressionAs(method, context, right, pairTypeForArrayList(arrayType));
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "set",
                        "(ILjava/lang/Object;)Ljava/lang/Object;", false);
                method.visitInsn(Opcodes.POP);
                return true;
            }
            if (operation != KtTokens.EQ) {
                if (!isCompoundAssignment(operation)) {
                    throw new IllegalArgumentException("Unsupported array assignment: " + binary.getText());
                }
                return emitArrayCompoundAssignment(method, context, binary, arrayType, right);
            }
            ValueType elementType = indexedElementType(arrayType);
            ValueType valueType = emitExpression(method, context, right);
            PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(arrayType);
            if (primitiveShape != null && valueType == primitiveShape.elementType) {
                method.visitInsn(primitiveShape.storeOpcode);
                return true;
            }
            if (elementType == ValueType.INT_ARRAY_LIST && valueType == ValueType.INT_ARRAY_LIST) {
                method.visitInsn(Opcodes.AASTORE);
                return true;
            }
            if (isPairArrayListType(elementType) && valueType == elementType) {
                method.visitInsn(Opcodes.AASTORE);
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
        PrimitiveArrayShape shape = primitiveArrayShapeForArrayType(arrayType);
        if (shape == null || !shape.elementType.numeric) {
            throw new IllegalArgumentException("Array compound assignment only supports numeric arrays: "
                    + binary.getText());
        }
        method.visitInsn(Opcodes.DUP2);
        method.visitInsn(shape.loadOpcode);
        emitExpressionAs(method, context, right, shape.elementType);
        emitArithmeticOpcode(method, binary.getOperationToken(), shape.elementType);
        method.visitInsn(shape.storeOpcode);
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
            if (arrayType == ValueType.INT_ARRAY_LIST) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "get",
                        "(I)Ljava/lang/Object;", false);
                unboxInt(method);
                return ValueType.INT;
            }
            if (arrayType == ValueType.LONG_ARRAY_LIST) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "get",
                        "(I)Ljava/lang/Object;", false);
                unboxLong(method);
                return ValueType.LONG;
            }
            if (arrayType == ValueType.STRING_ARRAY_LIST) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "get",
                        "(I)Ljava/lang/Object;", false);
                method.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/String");
                return ValueType.STRING;
            }
            if (isPairArrayListType(arrayType)) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "get",
                        "(I)Ljava/lang/Object;", false);
                method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/AbstractMap$SimpleEntry");
                return pairTypeForArrayList(arrayType);
            }
            if (isHashMapType(arrayType)) {
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/HashMap", "get",
                        "(Ljava/lang/Object;)Ljava/lang/Object;", false);
                ValueType valueType = hashMapValueType(arrayType);
                unboxValue(method, valueType);
                return valueType;
            }
            ValueType elementType = indexedElementType(arrayType);
            PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(arrayType);
            if (primitiveShape != null) {
                method.visitInsn(primitiveShape.loadOpcode);
                return primitiveShape.elementType;
            }
            if (elementType == ValueType.INT_ARRAY_LIST) {
                method.visitInsn(Opcodes.AALOAD);
                method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/ArrayList");
                return ValueType.INT_ARRAY_LIST;
            }
            if (isPairArrayListType(elementType)) {
                method.visitInsn(Opcodes.AALOAD);
                method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/ArrayList");
                return elementType;
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
                String collectionOwner = sizedCollectionOwner(receiverType);
                if (collectionOwner != null) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, collectionOwner, "size", "()I", false);
                    return ValueType.INT;
                }
            }
            if (selector != null && "lastIndex".equals(selector.getText())) {
                ValueType receiverType = emitExpression(method, context, receiver);
                if (receiverType.array) {
                    method.visitInsn(Opcodes.ARRAYLENGTH);
                } else if (receiverType == ValueType.STRING) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length", "()I", false);
                } else if (isArrayListType(receiverType)) {
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "size", "()I", false);
                } else {
                    throw new IllegalArgumentException("Unsupported lastIndex receiver: " + receiver.getText());
                }
                method.visitInsn(Opcodes.ICONST_1);
                method.visitInsn(Opcodes.ISUB);
                return ValueType.INT;
            }
            if (selector != null && ("first".equals(selector.getText()) || "second".equals(selector.getText()))) {
                ValueType receiverType = inferExpressionType(context, receiver);
                if (isPairType(receiverType)) {
                    boolean first = "first".equals(selector.getText());
                    emitExpressionAs(method, context, receiver, receiverType);
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/AbstractMap$SimpleEntry",
                            first ? "getKey" : "getValue",
                            "()Ljava/lang/Object;", false);
                    ValueType componentType = pairComponentType(receiverType, first ? 0 : 1);
                    unboxValue(method, componentType);
                    return componentType;
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
                    if (receiverType.numeric) {
                        if ("toInt".equals(callee.getText())) {
                            if (receiverType == ValueType.LONG) {
                                method.visitInsn(Opcodes.L2I);
                            } else if (receiverType == ValueType.DOUBLE) {
                                method.visitInsn(Opcodes.D2I);
                            }
                            return ValueType.INT;
                        }
                        if ("toLong".equals(callee.getText())) {
                            if (receiverType == ValueType.INT) {
                                method.visitInsn(Opcodes.I2L);
                            } else if (receiverType == ValueType.DOUBLE) {
                                method.visitInsn(Opcodes.D2L);
                            }
                            return ValueType.LONG;
                        }
                        if (receiverType == ValueType.INT) {
                            method.visitInsn(Opcodes.I2D);
                        } else if (receiverType == ValueType.LONG) {
                            method.visitInsn(Opcodes.L2D);
                        }
                        return ValueType.DOUBLE;
                    }
                }
                if (callee != null
                        && ("coerceAtLeast".equals(callee.getText())
                                || "coerceAtMost".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    KtExpression argument = ((KtCallExpression) selector).getValueArguments()
                            .get(0).getArgumentExpression();
                    ValueType receiverType = inferExpressionType(context, receiver);
                    ValueType argumentType = inferExpressionType(context, argument);
                    if (!receiverType.numeric || !argumentType.numeric) {
                        throw new IllegalArgumentException(callee.getText() + " only supports numbers: "
                                + qualified.getText());
                    }
                    ValueType type = promotedNumericType(receiverType, argumentType);
                    emitExpressionAs(method, context, receiver, type);
                    emitExpressionAs(method, context, argument, type);
                    method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Math",
                            "coerceAtLeast".equals(callee.getText()) ? "max" : "min",
                            "(" + type.descriptor + type.descriptor + ")" + type.descriptor, false);
                    return type;
                }
                if (callee != null && "coerceIn".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2) {
                    KtExpression lower = ((KtCallExpression) selector).getValueArguments()
                            .get(0).getArgumentExpression();
                    KtExpression upper = ((KtCallExpression) selector).getValueArguments()
                            .get(1).getArgumentExpression();
                    ValueType receiverType = inferExpressionType(context, receiver);
                    ValueType lowerType = inferExpressionType(context, lower);
                    ValueType upperType = inferExpressionType(context, upper);
                    if (!receiverType.numeric || !lowerType.numeric || !upperType.numeric) {
                        throw new IllegalArgumentException("coerceIn only supports numbers: "
                                + qualified.getText());
                    }
                    ValueType type = promotedNumericType(promotedNumericType(receiverType, lowerType), upperType);
                    emitExpressionAs(method, context, receiver, type);
                    emitExpressionAs(method, context, lower, type);
                    method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Math", "max",
                            "(" + type.descriptor + type.descriptor + ")" + type.descriptor, false);
                    emitExpressionAs(method, context, upper, type);
                    method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Math", "min",
                            "(" + type.descriptor + type.descriptor + ")" + type.descriptor, false);
                    return type;
                }
                if (callee != null && ("trim".equals(callee.getText()) || "lowercase".equals(callee.getText())
                        || "uppercase".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, receiver);
                    if (receiverType == ValueType.STRING) {
                        emitExpressionAs(method, context, receiver, ValueType.STRING);
                        String methodName = callee.getText();
                        if ("lowercase".equals(methodName)) {
                            methodName = "toLowerCase";
                        } else if ("uppercase".equals(methodName)) {
                            methodName = "toUpperCase";
                        }
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", methodName,
                                "()Ljava/lang/String;", false);
                        return ValueType.STRING;
                    }
                }
                if (callee != null && "substring".equals(callee.getText())
                        && (((KtCallExpression) selector).getValueArguments().size() == 1
                                || ((KtCallExpression) selector).getValueArguments().size() == 2)) {
                    ValueType receiverType = inferExpressionType(context, receiver);
                    if (receiverType == ValueType.STRING) {
                        emitExpressionAs(method, context, receiver, ValueType.STRING);
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                ValueType.INT);
                        if (((KtCallExpression) selector).getValueArguments().size() == 1) {
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "substring",
                                    "(I)Ljava/lang/String;", false);
                        } else {
                            emitExpressionAs(method, context,
                                    ((KtCallExpression) selector).getValueArguments().get(1)
                                            .getArgumentExpression(),
                                    ValueType.INT);
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "substring",
                                    "(II)Ljava/lang/String;", false);
                        }
                        return ValueType.STRING;
                    }
                }
                if (callee != null && ("startsWith".equals(callee.getText()) || "endsWith".equals(callee.getText())
                        || "contains".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, receiver);
                    if (receiverType == ValueType.STRING) {
                        emitExpressionAs(method, context, receiver, ValueType.STRING);
                        KtExpression argument = ((KtCallExpression) selector).getValueArguments()
                                .get(0).getArgumentExpression();
                        ValueType argumentType = inferExpressionType(context, argument);
                        if ("contains".equals(callee.getText())) {
                            if (argumentType == ValueType.CHAR) {
                                emitExpressionAs(method, context, argument, ValueType.CHAR);
                                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "indexOf",
                                        "(I)I", false);
                                Label trueLabel = new Label();
                                Label endLabel = new Label();
                                method.visitInsn(Opcodes.ICONST_M1);
                                method.visitJumpInsn(Opcodes.IF_ICMPNE, trueLabel);
                                method.visitInsn(Opcodes.ICONST_0);
                                method.visitJumpInsn(Opcodes.GOTO, endLabel);
                                method.visitLabel(trueLabel);
                                method.visitInsn(Opcodes.ICONST_1);
                                method.visitLabel(endLabel);
                            } else {
                                emitExpressionAs(method, context, argument, ValueType.STRING);
                                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "contains",
                                        "(Ljava/lang/CharSequence;)Z", false);
                            }
                        } else {
                            emitExpressionAs(method, context, argument, ValueType.STRING);
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", callee.getText(),
                                    "(Ljava/lang/String;)Z", false);
                        }
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && ("indexOf".equals(callee.getText()) || "lastIndexOf".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, receiver);
                    if (receiverType == ValueType.STRING) {
                        emitExpressionAs(method, context, receiver, ValueType.STRING);
                        KtExpression argument = ((KtCallExpression) selector).getValueArguments()
                                .get(0).getArgumentExpression();
                        ValueType argumentType = inferExpressionType(context, argument);
                        if (argumentType == ValueType.CHAR) {
                            emitExpressionAs(method, context, argument, ValueType.CHAR);
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", callee.getText(),
                                    "(I)I", false);
                            return ValueType.INT;
                        }
                        if (argumentType == ValueType.STRING) {
                            emitExpressionAs(method, context, argument, ValueType.STRING);
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", callee.getText(),
                                    "(Ljava/lang/String;)I", false);
                            return ValueType.INT;
                        }
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
                    if (receiverType == ValueType.INT_ARRAY_LIST) {
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Collections", "sort",
                                "(Ljava/util/List;)V", false);
                        return ValueType.VOID;
                    }
                    if (receiverType == ValueType.LONG_ARRAY_LIST) {
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Collections", "sort",
                                "(Ljava/util/List;)V", false);
                        return ValueType.VOID;
                    }
                    if (receiverType == ValueType.STRING_ARRAY_LIST) {
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Collections", "sort",
                                "(Ljava/util/List;)V", false);
                        return ValueType.VOID;
                    }
                }
                if (callee != null
                        && ("reverse".equals(callee.getText()) || "sortDescending".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, receiver);
                    boolean sortDescending = "sortDescending".equals(callee.getText());
                    if (isReversiblePrimitiveArrayType(receiverType)
                            && (!sortDescending || isSortablePrimitiveArrayType(receiverType))) {
                        int receiverIndex = context.allocateTemporary(receiverType);
                        emitExpressionAs(method, context, receiver, receiverType);
                        method.visitVarInsn(Opcodes.ASTORE, receiverIndex);
                        if (sortDescending) {
                            method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Arrays", "sort",
                                    "(" + receiverType.descriptor + ")V", false);
                        }
                        int leftIndex = context.allocateTemporary(ValueType.INT);
                        method.visitInsn(Opcodes.ICONST_0);
                        method.visitVarInsn(Opcodes.ISTORE, leftIndex);
                        int rightIndex = context.allocateTemporary(ValueType.INT);
                        method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                        method.visitInsn(Opcodes.ARRAYLENGTH);
                        method.visitInsn(Opcodes.ICONST_1);
                        method.visitInsn(Opcodes.ISUB);
                        method.visitVarInsn(Opcodes.ISTORE, rightIndex);
                        ValueType elementType = indexedElementType(receiverType);
                        int temporaryIndex = context.allocateTemporary(elementType);
                        Label startLabel = new Label();
                        Label endLabel = new Label();
                        method.visitLabel(startLabel);
                        method.visitVarInsn(Opcodes.ILOAD, leftIndex);
                        method.visitVarInsn(Opcodes.ILOAD, rightIndex);
                        method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
                        method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                        method.visitVarInsn(Opcodes.ILOAD, leftIndex);
                        PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(receiverType);
                        method.visitInsn(primitiveShape.loadOpcode);
                        storeLocal(method, elementType, temporaryIndex);
                        method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                        method.visitVarInsn(Opcodes.ILOAD, leftIndex);
                        method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                        method.visitVarInsn(Opcodes.ILOAD, rightIndex);
                        method.visitInsn(primitiveShape.loadOpcode);
                        method.visitInsn(primitiveShape.storeOpcode);
                        method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                        method.visitVarInsn(Opcodes.ILOAD, rightIndex);
                        loadLocal(method, elementType, temporaryIndex);
                        method.visitInsn(primitiveShape.storeOpcode);
                        method.visitIincInsn(leftIndex, 1);
                        method.visitIincInsn(rightIndex, -1);
                        method.visitJumpInsn(Opcodes.GOTO, startLabel);
                        method.visitLabel(endLabel);
                        return ValueType.VOID;
                    }
                    if (isReversibleArrayListType(receiverType)
                            && (!sortDescending || isSortableArrayListType(receiverType))) {
                        emitExpressionAs(method, context, receiver, receiverType);
                        if (sortDescending) {
                            method.visitInsn(Opcodes.DUP);
                            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Collections", "sort",
                                    "(Ljava/util/List;)V", false);
                        }
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Collections", "reverse",
                                "(Ljava/util/List;)V", false);
                        return ValueType.VOID;
                    }
                }
                if (callee != null && "fill".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY
                            || receiverType == ValueType.BOOLEAN_ARRAY) {
                        ValueType elementType = indexedElementType(receiverType);
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                elementType);
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Arrays", "fill",
                                "(" + receiverType.descriptor + elementType.descriptor + ")V", false);
                        return ValueType.VOID;
                    }
                }
                if (callee != null && "copyOf".equals(callee.getText())
                        && (((KtCallExpression) selector).getValueArguments().isEmpty()
                                || ((KtCallExpression) selector).getValueArguments().size() == 1)) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY
                            || receiverType == ValueType.BOOLEAN_ARRAY) {
                        if (((KtCallExpression) selector).getValueArguments().isEmpty()) {
                            method.visitInsn(Opcodes.DUP);
                            method.visitInsn(Opcodes.ARRAYLENGTH);
                        } else {
                            emitExpressionAs(method, context,
                                    ((KtCallExpression) selector).getValueArguments().get(0)
                                            .getArgumentExpression(),
                                    ValueType.INT);
                        }
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Arrays", "copyOf",
                                "(" + receiverType.descriptor + "I)" + receiverType.descriptor, false);
                        return receiverType;
                    }
                }
                if (callee != null && "copyOfRange".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY
                            || receiverType == ValueType.BOOLEAN_ARRAY) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                ValueType.INT);
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(1).getArgumentExpression(),
                                ValueType.INT);
                        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Arrays", "copyOfRange",
                                "(" + receiverType.descriptor + "II)" + receiverType.descriptor, false);
                        return receiverType;
                    }
                }
                if (callee != null && "sum".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, receiver);
                    ValueType aggregateType = numericAggregateType(receiverType);
                    if (aggregateType != null) {
                        PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(receiverType);
                        if (primitiveShape != null && primitiveShape.elementType.numeric) {
                            int receiverIndex = context.allocateTemporary(receiverType);
                            emitExpressionAs(method, context, receiver, receiverType);
                            method.visitVarInsn(Opcodes.ASTORE, receiverIndex);
                            int resultIndex = context.allocateTemporary(aggregateType);
                            if (aggregateType == ValueType.LONG) {
                                method.visitInsn(Opcodes.LCONST_0);
                            } else if (aggregateType == ValueType.DOUBLE) {
                                method.visitInsn(Opcodes.DCONST_0);
                            } else {
                                method.visitInsn(Opcodes.ICONST_0);
                            }
                            storeLocal(method, aggregateType, resultIndex);
                            int loopIndex = context.allocateTemporary(ValueType.INT);
                            method.visitInsn(Opcodes.ICONST_0);
                            method.visitVarInsn(Opcodes.ISTORE, loopIndex);
                            Label startLabel = new Label();
                            Label endLabel = new Label();
                            method.visitLabel(startLabel);
                            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
                            method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                            method.visitInsn(Opcodes.ARRAYLENGTH);
                            method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
                            loadLocal(method, aggregateType, resultIndex);
                            method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
                            method.visitInsn(primitiveShape.loadOpcode);
                            if (aggregateType == ValueType.LONG) {
                                method.visitInsn(Opcodes.LADD);
                            } else if (aggregateType == ValueType.DOUBLE) {
                                method.visitInsn(Opcodes.DADD);
                            } else {
                                method.visitInsn(Opcodes.IADD);
                            }
                            storeLocal(method, aggregateType, resultIndex);
                            method.visitIincInsn(loopIndex, 1);
                            method.visitJumpInsn(Opcodes.GOTO, startLabel);
                            method.visitLabel(endLabel);
                            loadLocal(method, aggregateType, resultIndex);
                            return aggregateType;
                        }
                        if (receiverType == ValueType.INT_ARRAY_LIST || receiverType == ValueType.LONG_ARRAY_LIST) {
                            int receiverIndex = context.allocateTemporary(receiverType);
                            emitExpressionAs(method, context, receiver, receiverType);
                            method.visitVarInsn(Opcodes.ASTORE, receiverIndex);
                            int resultIndex = context.allocateTemporary(aggregateType);
                            if (aggregateType == ValueType.LONG) {
                                method.visitInsn(Opcodes.LCONST_0);
                            } else {
                                method.visitInsn(Opcodes.ICONST_0);
                            }
                            storeLocal(method, aggregateType, resultIndex);
                            int loopIndex = context.allocateTemporary(ValueType.INT);
                            method.visitInsn(Opcodes.ICONST_0);
                            method.visitVarInsn(Opcodes.ISTORE, loopIndex);
                            Label startLabel = new Label();
                            Label endLabel = new Label();
                            method.visitLabel(startLabel);
                            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
                            method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "size", "()I",
                                    false);
                            method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
                            loadLocal(method, aggregateType, resultIndex);
                            method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "get",
                                    "(I)Ljava/lang/Object;", false);
                            if (receiverType == ValueType.LONG_ARRAY_LIST) {
                                unboxLong(method);
                                method.visitInsn(Opcodes.LADD);
                            } else {
                                unboxInt(method);
                                method.visitInsn(Opcodes.IADD);
                            }
                            storeLocal(method, aggregateType, resultIndex);
                            method.visitIincInsn(loopIndex, 1);
                            method.visitJumpInsn(Opcodes.GOTO, startLabel);
                            method.visitLabel(endLabel);
                            loadLocal(method, aggregateType, resultIndex);
                            return aggregateType;
                        }
                    }
                }
                if (callee != null
                        && ("minOrNull".equals(callee.getText()) || "maxOrNull".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, receiver);
                    ValueType aggregateType = numericAggregateType(receiverType);
                    if (aggregateType != null) {
                        boolean max = "maxOrNull".equals(callee.getText());
                        PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(receiverType);
                        if (primitiveShape != null && primitiveShape.elementType.numeric) {
                            int receiverIndex = context.allocateTemporary(receiverType);
                            emitExpressionAs(method, context, receiver, receiverType);
                            method.visitVarInsn(Opcodes.ASTORE, receiverIndex);
                            int resultIndex = context.allocateTemporary(aggregateType);
                            method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                            method.visitInsn(Opcodes.ICONST_0);
                            method.visitInsn(primitiveShape.loadOpcode);
                            storeLocal(method, aggregateType, resultIndex);
                            int loopIndex = context.allocateTemporary(ValueType.INT);
                            method.visitInsn(Opcodes.ICONST_1);
                            method.visitVarInsn(Opcodes.ISTORE, loopIndex);
                            Label startLabel = new Label();
                            Label endLabel = new Label();
                            method.visitLabel(startLabel);
                            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
                            method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                            method.visitInsn(Opcodes.ARRAYLENGTH);
                            method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
                            loadLocal(method, aggregateType, resultIndex);
                            method.visitVarInsn(Opcodes.ALOAD, receiverIndex);
                            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
                            String descriptor;
                            method.visitInsn(primitiveShape.loadOpcode);
                            if (aggregateType == ValueType.LONG) {
                                descriptor = "(JJ)J";
                            } else if (aggregateType == ValueType.DOUBLE) {
                                descriptor = "(DD)D";
                            } else {
                                descriptor = "(II)I";
                            }
                            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Math", max ? "max" : "min",
                                    descriptor, false);
                            storeLocal(method, aggregateType, resultIndex);
                            method.visitIincInsn(loopIndex, 1);
                            method.visitJumpInsn(Opcodes.GOTO, startLabel);
                            method.visitLabel(endLabel);
                            loadLocal(method, aggregateType, resultIndex);
                            return aggregateType;
                        }
                        if (receiverType == ValueType.INT_ARRAY_LIST || receiverType == ValueType.LONG_ARRAY_LIST) {
                            emitExpressionAs(method, context, receiver, receiverType);
                            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/util/Collections",
                                    max ? "max" : "min",
                                    "(Ljava/util/Collection;)Ljava/lang/Object;", false);
                            if (receiverType == ValueType.LONG_ARRAY_LIST) {
                                unboxLong(method);
                                return ValueType.LONG;
                            }
                            unboxInt(method);
                            return ValueType.INT;
                        }
                    }
                }
                if (callee != null && "add".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    String scalarOwner = scalarCollectionOwner(receiverType);
                    if (scalarShape != null && scalarOwner != null) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                scalarShape.elementType);
                        boxValue(method, scalarShape.elementType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, scalarOwner, "add",
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    if (isPairArrayListType(receiverType)) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                pairTypeForArrayList(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "add",
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    if (isPairPriorityQueueType(receiverType)) {
                        emitPackedPairPriorityQueueElement(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                receiverType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/PriorityQueue", "add",
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    if (isPairArrayDequeType(receiverType)) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                pairTypeForArrayDeque(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", "add",
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && "add".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    String scalarOwner = scalarArrayListOwner(receiverType);
                    if (scalarShape != null && scalarOwner != null) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                ValueType.INT);
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(1).getArgumentExpression(),
                                scalarShape.elementType);
                        boxValue(method, scalarShape.elementType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, scalarOwner, "add",
                                "(ILjava/lang/Object;)V", false);
                        return ValueType.VOID;
                    }
                    if (isPairArrayListType(receiverType)) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                ValueType.INT);
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(1).getArgumentExpression(),
                                pairTypeForArrayList(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "add",
                                "(ILjava/lang/Object;)V", false);
                        return ValueType.VOID;
                    }
                }
                if (callee != null && "put".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (isHashMapType(receiverType)) {
                        emitBoxedExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                hashMapKeyType(receiverType));
                        emitBoxedExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(1).getArgumentExpression(),
                                hashMapValueType(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/HashMap", "put",
                                "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;", false);
                        method.visitInsn(Opcodes.POP);
                        return ValueType.VOID;
                    }
                }
                if (callee != null && "offer".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    String scalarOwner = scalarOfferOwner(receiverType);
                    if (scalarShape != null && scalarOwner != null) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                scalarShape.elementType);
                        boxValue(method, scalarShape.elementType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, scalarOwner, "offer",
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    if (isPairPriorityQueueType(receiverType)) {
                        emitPackedPairPriorityQueueElement(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                receiverType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/PriorityQueue", "offer",
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    if (isPairArrayDequeType(receiverType)) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                pairTypeForArrayDeque(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", "offer",
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && ("addFirst".equals(callee.getText()) || "addLast".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    String scalarOwner = scalarDequeOwner(receiverType);
                    if (scalarShape != null && scalarOwner != null) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                scalarShape.elementType);
                        boxValue(method, scalarShape.elementType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, scalarOwner, callee.getText(),
                                "(Ljava/lang/Object;)V", false);
                        return ValueType.VOID;
                    }
                    if (isPairArrayDequeType(receiverType)) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                pairTypeForArrayDeque(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", callee.getText(),
                                "(Ljava/lang/Object;)V", false);
                        return ValueType.VOID;
                    }
                }
                if (callee != null && ("offerFirst".equals(callee.getText()) || "offerLast".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    String scalarOwner = scalarDequeOwner(receiverType);
                    if (scalarShape != null && scalarOwner != null) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                scalarShape.elementType);
                        boxValue(method, scalarShape.elementType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, scalarOwner, callee.getText(),
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    if (isPairArrayDequeType(receiverType)) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                pairTypeForArrayDeque(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", callee.getText(),
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && "isEmpty".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    String collectionOwner = sizedCollectionOwner(receiverType);
                    if (collectionOwner != null) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, collectionOwner, "isEmpty", "()Z", false);
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && ("contains".equals(callee.getText()) || "remove".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (isPairArrayListType(receiverType)) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                pairTypeForArrayList(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", callee.getText(),
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    String scalarOwner = scalarCollectionOwner(receiverType);
                    if (scalarShape != null && scalarOwner != null) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                scalarShape.elementType);
                        boxValue(method, scalarShape.elementType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, scalarOwner, callee.getText(),
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    if (isPairPriorityQueueType(receiverType)) {
                        emitPackedPairPriorityQueueElement(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                receiverType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/PriorityQueue", callee.getText(),
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                    if (isHashMapType(receiverType) && "remove".equals(callee.getText())) {
                        emitBoxedExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                hashMapKeyType(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/HashMap", "remove",
                                "(Ljava/lang/Object;)Ljava/lang/Object;", false);
                        ValueType valueType = hashMapValueType(receiverType);
                        unboxValue(method, valueType);
                        return valueType;
                    }
                }
                if (callee != null && "removeAt".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    String scalarOwner = scalarArrayListOwner(receiverType);
                    if (scalarShape != null && scalarOwner != null) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                ValueType.INT);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, scalarOwner, "remove",
                                "(I)Ljava/lang/Object;", false);
                        unboxValue(method, scalarShape.elementType);
                        return scalarShape.elementType;
                    }
                    if (isPairArrayListType(receiverType)) {
                        emitExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                ValueType.INT);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "remove",
                                "(I)Ljava/lang/Object;", false);
                        method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/AbstractMap$SimpleEntry");
                        return pairTypeForArrayList(receiverType);
                    }
                }
                if (callee != null && "containsKey".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (isHashMapType(receiverType)) {
                        emitBoxedExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                hashMapKeyType(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/HashMap", "containsKey",
                                "(Ljava/lang/Object;)Z", false);
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && "get".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (isHashMapType(receiverType)) {
                        emitBoxedExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                hashMapKeyType(receiverType));
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/HashMap", "get",
                                "(Ljava/lang/Object;)Ljava/lang/Object;", false);
                        ValueType valueType = hashMapValueType(receiverType);
                        unboxValue(method, valueType);
                        return valueType;
                    }
                }
                if (callee != null && "getOrDefault".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (isHashMapType(receiverType)) {
                        emitBoxedExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression(),
                                hashMapKeyType(receiverType));
                        ValueType valueType = hashMapValueType(receiverType);
                        emitBoxedExpressionAs(method, context,
                                ((KtCallExpression) selector).getValueArguments().get(1).getArgumentExpression(),
                                valueType);
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/HashMap", "getOrDefault",
                                "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;", false);
                        unboxValue(method, valueType);
                        return valueType;
                    }
                }
                if (callee != null && "clear".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    String collectionOwner = sizedCollectionOwner(receiverType);
                    if (collectionOwner != null) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, collectionOwner, "clear", "()V", false);
                        return ValueType.VOID;
                    }
                }
                if (callee != null && ("first".equals(callee.getText()) || "last".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, receiver);
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY
                            || receiverType == ValueType.BOOLEAN_ARRAY || receiverType == ValueType.STRING) {
                        emitExpressionAs(method, context, receiver, receiverType);
                        if ("last".equals(callee.getText())) {
                            method.visitInsn(Opcodes.DUP);
                            if (receiverType == ValueType.STRING) {
                                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length",
                                        "()I", false);
                            } else {
                                method.visitInsn(Opcodes.ARRAYLENGTH);
                            }
                            method.visitInsn(Opcodes.ICONST_1);
                            method.visitInsn(Opcodes.ISUB);
                        } else {
                            method.visitInsn(Opcodes.ICONST_0);
                        }
                        if (receiverType == ValueType.STRING) {
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "charAt", "(I)C",
                                    false);
                            return ValueType.CHAR;
                        }
                        PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(receiverType);
                        if (primitiveShape != null) {
                            method.visitInsn(primitiveShape.loadOpcode);
                            return primitiveShape.elementType;
                        }
                    }
                    if (isArrayListType(receiverType)) {
                        emitExpressionAs(method, context, receiver, receiverType);
                        if ("last".equals(callee.getText())) {
                            method.visitInsn(Opcodes.DUP);
                            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "size", "()I",
                                    false);
                            method.visitInsn(Opcodes.ICONST_1);
                            method.visitInsn(Opcodes.ISUB);
                        } else {
                            method.visitInsn(Opcodes.ICONST_0);
                        }
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "get",
                                "(I)Ljava/lang/Object;", false);
                        ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                        if (scalarShape != null && scalarArrayListOwner(receiverType) != null) {
                            unboxValue(method, scalarShape.elementType);
                            return scalarShape.elementType;
                        }
                        method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/AbstractMap$SimpleEntry");
                        if (isPairArrayListType(receiverType)) {
                            return pairTypeForArrayList(receiverType);
                        }
                    }
                }
                if (callee != null && ("peek".equals(callee.getText()) || "poll".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.INT_PRIORITY_QUEUE) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/PriorityQueue", callee.getText(),
                                "()Ljava/lang/Object;", false);
                        unboxInt(method);
                        return ValueType.INT;
                    }
                    if (receiverType == ValueType.LONG_PRIORITY_QUEUE) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/PriorityQueue", callee.getText(),
                                "()Ljava/lang/Object;", false);
                        unboxLong(method);
                        return ValueType.LONG;
                    }
                    if (isPairPriorityQueueType(receiverType)) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/PriorityQueue", callee.getText(),
                                "()Ljava/lang/Object;", false);
                        return emitPairFromPackedPriorityQueueElement(method, context, receiverType);
                    }
                    if (receiverType == ValueType.INT_ARRAY_DEQUE) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", callee.getText(),
                                "()Ljava/lang/Object;", false);
                        unboxInt(method);
                        return ValueType.INT;
                    }
                    if (receiverType == ValueType.LONG_ARRAY_DEQUE) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", callee.getText(),
                                "()Ljava/lang/Object;", false);
                        unboxLong(method);
                        return ValueType.LONG;
                    }
                    if (isPairArrayDequeType(receiverType)) {
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", callee.getText(),
                                "()Ljava/lang/Object;", false);
                        method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/AbstractMap$SimpleEntry");
                        return pairTypeForArrayDeque(receiverType);
                    }
                }
                if (callee != null && ("peekFirst".equals(callee.getText()) || "peekLast".equals(callee.getText())
                        || "pollFirst".equals(callee.getText()) || "pollLast".equals(callee.getText())
                        || "removeFirst".equals(callee.getText()) || "removeLast".equals(callee.getText())
                        || "getFirst".equals(callee.getText()) || "getLast".equals(callee.getText())
                        || "first".equals(callee.getText()) || "last".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = emitExpression(method, context, receiver);
                    if (receiverType == ValueType.INT_ARRAY_DEQUE) {
                        String methodName = callee.getText();
                        if ("first".equals(methodName)) {
                            methodName = "getFirst";
                        } else if ("last".equals(methodName)) {
                            methodName = "getLast";
                        }
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", methodName,
                                "()Ljava/lang/Object;", false);
                        unboxInt(method);
                        return ValueType.INT;
                    }
                    if (receiverType == ValueType.LONG_ARRAY_DEQUE) {
                        String methodName = callee.getText();
                        if ("first".equals(methodName)) {
                            methodName = "getFirst";
                        } else if ("last".equals(methodName)) {
                            methodName = "getLast";
                        }
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", methodName,
                                "()Ljava/lang/Object;", false);
                        unboxLong(method);
                        return ValueType.LONG;
                    }
                    if (isPairArrayDequeType(receiverType)) {
                        String methodName = callee.getText();
                        if ("first".equals(methodName)) {
                            methodName = "getFirst";
                        } else if ("last".equals(methodName)) {
                            methodName = "getLast";
                        }
                        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", methodName,
                                "()Ljava/lang/Object;", false);
                        method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/AbstractMap$SimpleEntry");
                        return pairTypeForArrayDeque(receiverType);
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
            if (isContainsOperation(operation)) {
                return emitContainsExpression(method, context, binary);
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
            method.visitTypeInsn(Opcodes.ANEWARRAY, anewArrayComponentType(indexedElementType(arrayType)));
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
        PrimitiveArrayShape primitiveArrayShape = primitiveArrayShapeForConstructor(calleeText);
        if (primitiveArrayShape != null && parenthesizedArguments.size() == 1
                && call.getLambdaArguments().size() == 1) {
            KtExpression sizeExpression = parenthesizedArguments.get(0).getArgumentExpression();
            if (sizeExpression == null) {
                throw new IllegalArgumentException("Array size is missing: " + call.getText());
            }
            ValueType sizeType = emitExpression(method, context,
                    sizeExpression);
            if (sizeType != ValueType.INT) {
                throw new IllegalArgumentException("Array size must be Int: " + call.getText());
            }
            int countIndex = context.allocateTemporary(ValueType.INT);
            method.visitVarInsn(Opcodes.ISTORE, countIndex);
            method.visitVarInsn(Opcodes.ILOAD, countIndex);
            method.visitIntInsn(Opcodes.NEWARRAY, primitiveArrayShape.newArrayOperand);
            int arrayIndex = context.allocateTemporary(primitiveArrayShape.arrayType);
            method.visitVarInsn(Opcodes.ASTORE, arrayIndex);
            int loopIndex = context.allocateTemporary(ValueType.INT);
            method.visitInsn(Opcodes.ICONST_0);
            method.visitVarInsn(Opcodes.ISTORE, loopIndex);
            KtLambdaExpression lambda = call.getLambdaArguments().get(0).getLambdaExpression();
            String parameterName = lambdaParameterName(lambda, "it", call.getText());
            Local previousLocal = context.locals.get(parameterName);
            context.locals.put(parameterName, new Local(loopIndex, ValueType.INT));
            KtExpression initializer = singleLambdaResultExpression(lambda, call.getText());

            Label startLabel = new Label();
            Label endLabel = new Label();
            method.visitLabel(startLabel);
            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
            method.visitVarInsn(Opcodes.ILOAD, countIndex);
            method.visitJumpInsn(Opcodes.IF_ICMPGE, endLabel);
            method.visitVarInsn(Opcodes.ALOAD, arrayIndex);
            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
            emitExpressionAs(method, context, initializer, primitiveArrayShape.elementType);
            method.visitInsn(primitiveArrayShape.storeOpcode);
            method.visitIincInsn(loopIndex, 1);
            method.visitJumpInsn(Opcodes.GOTO, startLabel);
            method.visitLabel(endLabel);
            method.visitVarInsn(Opcodes.ALOAD, arrayIndex);
            if (previousLocal == null) {
                context.locals.remove(parameterName);
            } else {
                context.locals.put(parameterName, previousLocal);
            }
            return primitiveArrayShape.arrayType;
        }
        if (primitiveArrayShape != null && call.getValueArguments().size() == 1
                && call.getLambdaArguments().isEmpty()) {
            ValueType sizeType = emitExpression(method, context,
                    call.getValueArguments().get(0).getArgumentExpression());
            if (sizeType != ValueType.INT) {
                throw new IllegalArgumentException("Array size must be Int: " + call.getText());
            }
            method.visitIntInsn(Opcodes.NEWARRAY, primitiveArrayShape.newArrayOperand);
            return primitiveArrayShape.arrayType;
        }
        if ("StringBuilder".equals(calleeText) && call.getValueArguments().isEmpty()) {
            method.visitTypeInsn(Opcodes.NEW, "java/lang/StringBuilder");
            method.visitInsn(Opcodes.DUP);
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
            return ValueType.STRING_BUILDER;
        }
        if ((isArrayListConstructor(calleeText) || isMutableListFactory(calleeText))
                && call.getValueArguments().isEmpty()) {
            method.visitTypeInsn(Opcodes.NEW, "java/util/ArrayList");
            method.visitInsn(Opcodes.DUP);
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/util/ArrayList", "<init>", "()V", false);
            ValueType listType = arrayListTypeForFactoryOrConstructor(calleeText, call.getText());
            if (listType != null) {
                return listType;
            }
            return ValueType.INT_ARRAY_LIST;
        }
        ValueType priorityQueueType = priorityQueueTypeForConstructor(calleeText, call.getText());
        if (isPriorityQueueConstructor(calleeText)
                && (call.getValueArguments().isEmpty()
                        || isPairPriorityQueueType(priorityQueueType))) {
            method.visitTypeInsn(Opcodes.NEW, "java/util/PriorityQueue");
            method.visitInsn(Opcodes.DUP);
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/util/PriorityQueue", "<init>", "()V", false);
            if (priorityQueueType != null) {
                return priorityQueueType;
            }
            return ValueType.INT_PRIORITY_QUEUE;
        }
        if (isArrayDequeConstructor(calleeText) && call.getValueArguments().isEmpty()) {
            method.visitTypeInsn(Opcodes.NEW, "java/util/ArrayDeque");
            method.visitInsn(Opcodes.DUP);
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/util/ArrayDeque", "<init>", "()V", false);
            ValueType dequeType = arrayDequeTypeForConstructor(calleeText, call.getText());
            if (dequeType != null) {
                return dequeType;
            }
            return ValueType.INT_ARRAY_DEQUE;
        }
        if ((isHashSetConstructor(calleeText) || isMutableSetFactory(calleeText))
                && call.getValueArguments().isEmpty()) {
            method.visitTypeInsn(Opcodes.NEW, "java/util/HashSet");
            method.visitInsn(Opcodes.DUP);
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/util/HashSet", "<init>", "()V", false);
            ValueType setType = hashSetTypeForFactoryOrConstructor(calleeText, call.getText());
            if (setType != null) {
                return setType;
            }
            return ValueType.INT_HASH_SET;
        }
        if ((isHashMapConstructor(calleeText) || isMutableMapFactory(calleeText))
                && call.getValueArguments().isEmpty()) {
            method.visitTypeInsn(Opcodes.NEW, "java/util/HashMap");
            method.visitInsn(Opcodes.DUP);
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/util/HashMap", "<init>", "()V", false);
            ValueType mapType = hashMapTypeForFactoryOrConstructor(calleeText, call.getText());
            if (mapType != null) {
                return mapType;
            }
            return ValueType.INT_INT_HASH_MAP;
        }
        if ("Pair".equals(calleeText) && call.getValueArguments().size() == 2) {
            KtExpression firstArgument = call.getValueArguments().get(0).getArgumentExpression();
            KtExpression secondArgument = call.getValueArguments().get(1).getArgumentExpression();
            ValueType firstType = inferExpressionType(context, firstArgument);
            ValueType secondType = inferExpressionType(context, secondArgument);
            method.visitTypeInsn(Opcodes.NEW, "java/util/AbstractMap$SimpleEntry");
            method.visitInsn(Opcodes.DUP);
            if (firstType == ValueType.LONG) {
                emitExpressionAs(method, context, firstArgument, ValueType.LONG);
                boxLong(method);
                if (secondType == ValueType.LONG) {
                    emitExpressionAs(method, context, secondArgument, ValueType.LONG);
                    boxLong(method);
                } else {
                    emitExpressionAs(method, context, secondArgument, ValueType.INT);
                    boxInt(method);
                }
            } else {
                emitExpressionAs(method, context, firstArgument, ValueType.INT);
                boxInt(method);
                if (secondType == ValueType.LONG) {
                    emitExpressionAs(method, context, secondArgument, ValueType.LONG);
                    boxLong(method);
                } else {
                    emitExpressionAs(method, context, secondArgument, ValueType.INT);
                    boxInt(method);
                }
            }
            method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/util/AbstractMap$SimpleEntry", "<init>",
                    "(Ljava/lang/Object;Ljava/lang/Object;)V", false);
            return pairTypeFromComponents(firstType, secondType);
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
        if (("sqrt".equals(calleeText) || "floor".equals(calleeText) || "ceil".equals(calleeText))
                && call.getValueArguments().size() == 1) {
            KtExpression argument = call.getValueArguments().get(0).getArgumentExpression();
            ValueType type = inferExpressionType(context, argument);
            if (!type.numeric) {
                throw new IllegalArgumentException(calleeText + " only supports numbers: " + call.getText());
            }
            emitExpressionAs(method, context, argument, ValueType.DOUBLE);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Math", calleeText, "(D)D", false);
            return ValueType.DOUBLE;
        }
        if ("pow".equals(calleeText) && call.getValueArguments().size() == 2) {
            KtExpression left = call.getValueArguments().get(0).getArgumentExpression();
            KtExpression right = call.getValueArguments().get(1).getArgumentExpression();
            ValueType leftType = inferExpressionType(context, left);
            ValueType rightType = inferExpressionType(context, right);
            if (!leftType.numeric || !rightType.numeric) {
                throw new IllegalArgumentException("pow only supports numbers: " + call.getText());
            }
            emitExpressionAs(method, context, left, ValueType.DOUBLE);
            emitExpressionAs(method, context, right, ValueType.DOUBLE);
            method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Math", "pow", "(DD)D", false);
            return ValueType.DOUBLE;
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
            if (!isIndexableType(arrayType)) {
                throw new IllegalArgumentException("Unsupported array type: " + expression.getText());
            }
            if (arrayType == ValueType.INT_ARRAY_LIST) {
                return ValueType.INT;
            }
            if (arrayType == ValueType.LONG_ARRAY_LIST) {
                return ValueType.LONG;
            }
            if (arrayType == ValueType.STRING_ARRAY_LIST) {
                return ValueType.STRING;
            }
            if (isPairArrayListType(arrayType)) {
                return pairTypeForArrayList(arrayType);
            }
            if (isHashMapType(arrayType)) {
                return hashMapValueType(arrayType);
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
            if (selector != null && "size".equals(selector.getText())) {
                ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                if (receiverType.array || sizedCollectionOwner(receiverType) != null) {
                    return ValueType.INT;
                }
            }
            if (selector != null && "lastIndex".equals(selector.getText())) {
                ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                if (receiverType.array || receiverType == ValueType.STRING
                        || receiverType == ValueType.INT_ARRAY_LIST
                        || receiverType == ValueType.LONG_ARRAY_LIST
                        || receiverType == ValueType.STRING_ARRAY_LIST
                        || isPairArrayListType(receiverType)) {
                    return ValueType.INT;
                }
            }
            if (selector != null && ("first".equals(selector.getText()) || "second".equals(selector.getText()))) {
                ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                if (isPairType(receiverType)) {
                    return pairComponentType(receiverType, "first".equals(selector.getText()) ? 0 : 1);
                }
            }
            if (selector instanceof KtCallExpression) {
                KtExpression callee = ((KtCallExpression) selector).getCalleeExpression();
                if (callee != null && ("toInt".equals(callee.getText()) || "toLong".equals(callee.getText())
                        || "toDouble".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.STRING || receiverType.numeric) {
                        if ("toInt".equals(callee.getText())) {
                            return ValueType.INT;
                        }
                        if ("toLong".equals(callee.getText())) {
                            return ValueType.LONG;
                        }
                        return ValueType.DOUBLE;
                    }
                }
                if (callee != null
                        && ("coerceAtLeast".equals(callee.getText())
                                || "coerceAtMost".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    ValueType argumentType = inferExpressionType(context,
                            ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression());
                    if (receiverType.numeric && argumentType.numeric) {
                        return promotedNumericType(receiverType, argumentType);
                    }
                }
                if (callee != null && "coerceIn".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    ValueType lowerType = inferExpressionType(context,
                            ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression());
                    ValueType upperType = inferExpressionType(context,
                            ((KtCallExpression) selector).getValueArguments().get(1).getArgumentExpression());
                    if (receiverType.numeric && lowerType.numeric && upperType.numeric) {
                        return promotedNumericType(promotedNumericType(receiverType, lowerType), upperType);
                    }
                }
                if (callee != null && ("trim".equals(callee.getText()) || "lowercase".equals(callee.getText())
                        || "uppercase".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()
                        && inferExpressionType(context, qualified.getReceiverExpression()) == ValueType.STRING) {
                    return ValueType.STRING;
                }
                if (callee != null && "substring".equals(callee.getText())
                        && (((KtCallExpression) selector).getValueArguments().size() == 1
                                || ((KtCallExpression) selector).getValueArguments().size() == 2)
                        && inferExpressionType(context, qualified.getReceiverExpression()) == ValueType.STRING) {
                    return ValueType.STRING;
                }
                if (callee != null && ("startsWith".equals(callee.getText()) || "endsWith".equals(callee.getText())
                        || "contains".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1
                        && inferExpressionType(context, qualified.getReceiverExpression()) == ValueType.STRING) {
                    return ValueType.BOOLEAN;
                }
                if (callee != null && ("indexOf".equals(callee.getText()) || "lastIndexOf".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1
                        && inferExpressionType(context, qualified.getReceiverExpression()) == ValueType.STRING) {
                    ValueType argumentType = inferExpressionType(context,
                            ((KtCallExpression) selector).getValueArguments().get(0).getArgumentExpression());
                    if (argumentType == ValueType.CHAR || argumentType == ValueType.STRING) {
                        return ValueType.INT;
                    }
                }
                if (callee != null && "sort".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY
                            || receiverType == ValueType.INT_ARRAY_LIST
                            || receiverType == ValueType.LONG_ARRAY_LIST
                            || receiverType == ValueType.STRING_ARRAY_LIST) {
                        return ValueType.VOID;
                    }
                }
                if (callee != null
                        && ("reverse".equals(callee.getText()) || "sortDescending".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if ("sortDescending".equals(callee.getText())) {
                        if (isSortablePrimitiveArrayType(receiverType) || isSortableArrayListType(receiverType)) {
                            return ValueType.VOID;
                        }
                    } else if (isReversiblePrimitiveArrayType(receiverType)
                            || isReversibleArrayListType(receiverType)) {
                        return ValueType.VOID;
                    }
                }
                if (callee != null && "fill".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY
                            || receiverType == ValueType.BOOLEAN_ARRAY) {
                        return ValueType.VOID;
                    }
                }
                if (callee != null && "copyOf".equals(callee.getText())
                        && (((KtCallExpression) selector).getValueArguments().isEmpty()
                                || ((KtCallExpression) selector).getValueArguments().size() == 1)) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY
                            || receiverType == ValueType.BOOLEAN_ARRAY) {
                        return receiverType;
                    }
                }
                if (callee != null && "copyOfRange".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.INT_ARRAY || receiverType == ValueType.LONG_ARRAY
                            || receiverType == ValueType.DOUBLE_ARRAY || receiverType == ValueType.CHAR_ARRAY
                            || receiverType == ValueType.BOOLEAN_ARRAY) {
                        return receiverType;
                    }
                }
                if (callee != null
                        && ("sum".equals(callee.getText()) || "minOrNull".equals(callee.getText())
                                || "maxOrNull".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType aggregateType = numericAggregateType(
                            inferExpressionType(context, qualified.getReceiverExpression()));
                    if (aggregateType != null) {
                        return aggregateType;
                    }
                }
                if (callee != null && "add".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (scalarCollectionShapeForType(receiverType) != null
                            || isPairArrayListType(receiverType)
                            || isPairPriorityQueueType(receiverType)
                            || isPairArrayDequeType(receiverType)) {
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && "add".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2
                        && isArrayListType(inferExpressionType(context, qualified.getReceiverExpression()))) {
                    return ValueType.VOID;
                }
                if (callee != null && "put".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2
                        && isHashMapType(inferExpressionType(context, qualified.getReceiverExpression()))) {
                    return ValueType.VOID;
                }
                if (callee != null && "offer".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (scalarOfferOwner(receiverType) != null
                            || isPairPriorityQueueType(receiverType)
                            || isPairArrayDequeType(receiverType)) {
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && ("addFirst".equals(callee.getText()) || "addLast".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (scalarDequeOwner(receiverType) != null || isPairArrayDequeType(receiverType)) {
                        return ValueType.VOID;
                    }
                }
                if (callee != null && ("offerFirst".equals(callee.getText()) || "offerLast".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (scalarDequeOwner(receiverType) != null || isPairArrayDequeType(receiverType)) {
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && "isEmpty".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (sizedCollectionOwner(receiverType) != null) {
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && ("contains".equals(callee.getText()) || "remove".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (scalarCollectionShapeForType(receiverType) != null
                            || isPairArrayListType(receiverType)
                            || isPairPriorityQueueType(receiverType)) {
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && "remove".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (isHashMapType(receiverType)) {
                        return hashMapValueType(receiverType);
                    }
                }
                if (callee != null && "removeAt".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    if (scalarShape != null && scalarArrayListOwner(receiverType) != null) {
                        return scalarShape.elementType;
                    }
                    if (isPairArrayListType(receiverType)) {
                        return pairTypeForArrayList(receiverType);
                    }
                }
                if (callee != null && "containsKey".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (isHashMapType(receiverType)) {
                        return ValueType.BOOLEAN;
                    }
                }
                if (callee != null && "get".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 1) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (isHashMapType(receiverType)) {
                        return hashMapValueType(receiverType);
                    }
                }
                if (callee != null && "getOrDefault".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().size() == 2) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (isHashMapType(receiverType)) {
                        return hashMapValueType(receiverType);
                    }
                }
                if (callee != null && "clear".equals(callee.getText())
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (sizedCollectionOwner(receiverType) != null) {
                        return ValueType.VOID;
                    }
                }
                if (callee != null && ("first".equals(callee.getText()) || "last".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.INT_ARRAY) {
                        return ValueType.INT;
                    }
                    if (receiverType == ValueType.LONG_ARRAY) {
                        return ValueType.LONG;
                    }
                    if (receiverType == ValueType.DOUBLE_ARRAY) {
                        return ValueType.DOUBLE;
                    }
                    if (receiverType == ValueType.CHAR_ARRAY || receiverType == ValueType.STRING) {
                        return ValueType.CHAR;
                    }
                    if (receiverType == ValueType.BOOLEAN_ARRAY) {
                        return ValueType.BOOLEAN;
                    }
                    ScalarCollectionShape scalarShape = scalarCollectionShapeForType(receiverType);
                    if (scalarShape != null && scalarArrayListOwner(receiverType) != null) {
                        return scalarShape.elementType;
                    }
                    if (isPairArrayListType(receiverType)) {
                        return pairTypeForArrayList(receiverType);
                    }
                }
                if (callee != null && ("peek".equals(callee.getText()) || "poll".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.INT_PRIORITY_QUEUE
                            || receiverType == ValueType.LONG_PRIORITY_QUEUE
                            || isPairPriorityQueueType(receiverType)
                            || receiverType == ValueType.INT_ARRAY_DEQUE
                            || receiverType == ValueType.LONG_ARRAY_DEQUE
                            || isPairArrayDequeType(receiverType)) {
                        if (receiverType == ValueType.LONG_PRIORITY_QUEUE
                                || receiverType == ValueType.LONG_ARRAY_DEQUE) {
                            return ValueType.LONG;
                        }
                        if (isPairPriorityQueueType(receiverType)) {
                            return pairTypeForPriorityQueue(receiverType);
                        }
                        if (isPairArrayDequeType(receiverType)) {
                            return pairTypeForArrayDeque(receiverType);
                        }
                        return ValueType.INT;
                    }
                }
                if (callee != null && ("peekFirst".equals(callee.getText()) || "peekLast".equals(callee.getText())
                        || "pollFirst".equals(callee.getText()) || "pollLast".equals(callee.getText())
                        || "removeFirst".equals(callee.getText()) || "removeLast".equals(callee.getText())
                        || "getFirst".equals(callee.getText()) || "getLast".equals(callee.getText())
                        || "first".equals(callee.getText()) || "last".equals(callee.getText()))
                        && ((KtCallExpression) selector).getValueArguments().isEmpty()) {
                    ValueType receiverType = inferExpressionType(context, qualified.getReceiverExpression());
                    if (receiverType == ValueType.INT_ARRAY_DEQUE
                            || receiverType == ValueType.LONG_ARRAY_DEQUE
                            || isPairArrayDequeType(receiverType)) {
                        if (receiverType == ValueType.LONG_ARRAY_DEQUE) {
                            return ValueType.LONG;
                        }
                        if (isPairArrayDequeType(receiverType)) {
                            return pairTypeForArrayDeque(receiverType);
                        }
                        return ValueType.INT;
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
            if (isComparison(operation) || isContainsOperation(operation)
                    || operation == KtTokens.ANDAND || operation == KtTokens.OROR) {
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
            PrimitiveArrayShape primitiveArrayShape = primitiveArrayShapeForConstructor(calleeText);
            if (primitiveArrayShape != null) {
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
                        if (initializerType == primitiveArrayShape.elementType
                                || initializerType == ValueType.INT && (primitiveArrayShape.elementType == ValueType.LONG
                                        || primitiveArrayShape.elementType == ValueType.DOUBLE)
                                || initializerType == ValueType.LONG
                                        && primitiveArrayShape.elementType == ValueType.DOUBLE) {
                            return primitiveArrayShape.arrayType;
                        }
                    } finally {
                        if (previousLocal == null) {
                            context.locals.remove(parameterName);
                        } else {
                            context.locals.put(parameterName, previousLocal);
                        }
                    }
                }
                if (((KtCallExpression) expression).getValueArguments().size() == 1
                        && ((KtCallExpression) expression).getLambdaArguments().isEmpty()) {
                    return primitiveArrayShape.arrayType;
                }
                return primitiveArrayShape.arrayType;
            }
            if ("StringBuilder".equals(calleeText)) {
                return ValueType.STRING_BUILDER;
            }
            if (isArrayListConstructor(calleeText) || isMutableListFactory(calleeText)) {
                ValueType listType = arrayListTypeForFactoryOrConstructor(calleeText, expression.getText());
                if (listType != null) {
                    return listType;
                }
                return ValueType.INT_ARRAY_LIST;
            }
            if (isPriorityQueueConstructor(calleeText)) {
                ValueType queueType = priorityQueueTypeForConstructor(calleeText, expression.getText());
                if (queueType != null) {
                    return queueType;
                }
                return ValueType.INT_PRIORITY_QUEUE;
            }
            if (isArrayDequeConstructor(calleeText)) {
                ValueType dequeType = arrayDequeTypeForConstructor(calleeText, expression.getText());
                if (dequeType != null) {
                    return dequeType;
                }
                return ValueType.INT_ARRAY_DEQUE;
            }
            if (isHashSetConstructor(calleeText) || isMutableSetFactory(calleeText)) {
                ValueType setType = hashSetTypeForFactoryOrConstructor(calleeText, expression.getText());
                if (setType != null) {
                    return setType;
                }
                return ValueType.INT_HASH_SET;
            }
            if (isHashMapConstructor(calleeText) || isMutableMapFactory(calleeText)) {
                ValueType mapType = hashMapTypeForFactoryOrConstructor(calleeText, expression.getText());
                if (mapType != null) {
                    return mapType;
                }
                return ValueType.INT_INT_HASH_MAP;
            }
            if ("Pair".equals(calleeText) && ((KtCallExpression) expression).getValueArguments().size() == 2) {
                KtExpression firstArgument = ((KtCallExpression) expression).getValueArguments().get(0)
                        .getArgumentExpression();
                KtExpression secondArgument = ((KtCallExpression) expression).getValueArguments().get(1)
                        .getArgumentExpression();
                ValueType firstType = inferExpressionType(context, firstArgument);
                ValueType secondType = inferExpressionType(context, secondArgument);
                return pairTypeFromComponents(firstType, secondType);
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
            if (("sqrt".equals(calleeText) || "floor".equals(calleeText) || "ceil".equals(calleeText))
                    && ((KtCallExpression) expression).getValueArguments().size() == 1) {
                KtExpression argument = ((KtCallExpression) expression).getValueArguments()
                        .get(0).getArgumentExpression();
                if (inferExpressionType(context, argument).numeric) {
                    return ValueType.DOUBLE;
                }
            }
            if ("pow".equals(calleeText) && ((KtCallExpression) expression).getValueArguments().size() == 2) {
                ValueType leftType = inferExpressionType(context,
                        ((KtCallExpression) expression).getValueArguments().get(0).getArgumentExpression());
                ValueType rightType = inferExpressionType(context,
                        ((KtCallExpression) expression).getValueArguments().get(1).getArgumentExpression());
                if (leftType.numeric && rightType.numeric) {
                    return ValueType.DOUBLE;
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
            if (local == null || !isIndexableType(local.type)) {
                throw new IllegalArgumentException("Unknown array local: " + arrayExpression.getText());
            }
            method.visitVarInsn(Opcodes.ALOAD, local.index);
            arrayType = local.type;
        } else {
            arrayType = emitExpression(method, context, arrayExpression);
            if (!isIndexableType(arrayType)) {
                throw new IllegalArgumentException("Unsupported array expression: " + arrayExpression.getText());
            }
        }
        ValueType indexType = emitExpression(method, context, expression.getIndexExpressions().get(0));
        if (isHashMapType(arrayType)) {
            ValueType keyType = hashMapKeyType(arrayType);
            if (indexType != keyType) {
                throw new IllegalArgumentException("Map index type mismatch: " + expression.getText());
            }
            boxValue(method, keyType);
            return arrayType;
        }
        if (indexType != ValueType.INT) {
            throw new IllegalArgumentException("Array index must be Int: " + expression.getText());
        }
        return arrayType;
    }

    private static boolean isIndexableType(ValueType type) {
        return type.array || type == ValueType.STRING || type == ValueType.INT_ARRAY_LIST
                || type == ValueType.LONG_ARRAY_LIST
                || type == ValueType.STRING_ARRAY_LIST
                || isPairArrayListType(type)
                || isHashMapType(type);
    }

    private static boolean isForEachRangeType(ValueType type) {
        return type.array || type == ValueType.STRING || isArrayListType(type);
    }

    private static boolean isArrayListType(ValueType type) {
        return type == ValueType.INT_ARRAY_LIST
                || type == ValueType.LONG_ARRAY_LIST
                || type == ValueType.STRING_ARRAY_LIST
                || isPairArrayListType(type);
    }

    private static boolean isPairArrayListType(ValueType type) {
        return pairShapeForArrayListType(type) != null;
    }

    private static ValueType pairTypeForArrayList(ValueType type) {
        PairShape shape = pairShapeForArrayListType(type);
        if (shape != null) {
            return shape.pairType;
        }
        throw new IllegalArgumentException("Unsupported Pair ArrayList type: " + type);
    }

    private static boolean isPairArrayListArrayType(ValueType type) {
        return pairShapeForArrayListArrayType(type) != null;
    }

    private static ValueType arrayListTypeForPairArrayListArray(ValueType type) {
        PairShape shape = pairShapeForArrayListArrayType(type);
        if (shape != null) {
            return shape.arrayListType;
        }
        throw new IllegalArgumentException("Unsupported Pair ArrayList array type: " + type);
    }

    private static ValueType arrayTypeForPairArrayList(ValueType type) {
        PairShape shape = pairShapeForArrayListType(type);
        if (shape != null) {
            return shape.arrayListArrayType;
        }
        throw new IllegalArgumentException("Unsupported Pair ArrayList type: " + type);
    }

    private static ValueType forEachElementType(ValueType rangeType) {
        if (rangeType == ValueType.STRING) {
            return ValueType.CHAR;
        }
        if (rangeType == ValueType.INT_ARRAY_LIST) {
            return ValueType.INT;
        }
        if (rangeType == ValueType.LONG_ARRAY_LIST) {
            return ValueType.LONG;
        }
        if (rangeType == ValueType.STRING_ARRAY_LIST) {
            return ValueType.STRING;
        }
        if (isPairArrayListType(rangeType)) {
            return pairTypeForArrayList(rangeType);
        }
        if (rangeType.array) {
            return indexedElementType(rangeType);
        }
        throw new IllegalArgumentException("Unsupported for-each range type: " + rangeType);
    }

    private static void emitForEachElement(MethodVisitor method, ValueType rangeType, int rangeIndex, int loopIndex) {
        ValueType elementType = forEachElementType(rangeType);
        loadLocal(method, rangeType, rangeIndex);
        method.visitVarInsn(Opcodes.ILOAD, loopIndex);
        if (rangeType == ValueType.STRING) {
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "charAt", "(I)C", false);
            return;
        }
        if (isArrayListType(rangeType)) {
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "get",
                    "(I)Ljava/lang/Object;", false);
            if (elementType == ValueType.INT) {
                unboxInt(method);
            } else if (elementType == ValueType.LONG) {
                unboxLong(method);
            } else if (elementType == ValueType.STRING) {
                method.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/String");
            } else {
                method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/AbstractMap$SimpleEntry");
            }
            return;
        }
        PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(rangeType);
        if (primitiveShape != null) {
            method.visitInsn(primitiveShape.loadOpcode);
        } else {
            method.visitInsn(Opcodes.AALOAD);
            if (isArrayListType(elementType)) {
                method.visitTypeInsn(Opcodes.CHECKCAST, "java/util/ArrayList");
            }
        }
    }

    private static ValueType pairComponentType(ValueType pairType, int componentIndex) {
        if (componentIndex < 0 || componentIndex > 1) {
            throw new IllegalArgumentException("Pair component index must be 0 or 1: " + componentIndex);
        }
        PairShape shape = pairShapeForPairType(pairType);
        if (shape != null) {
            return componentIndex == 0 ? shape.firstType : shape.secondType;
        }
        throw new IllegalArgumentException("Unsupported Pair type: " + pairType);
    }

    private static boolean isPairType(ValueType type) {
        return pairShapeForPairType(type) != null;
    }

    private static void emitPairComponent(MethodVisitor method, ValueType pairType, int pairIndex, int componentIndex) {
        ValueType componentType = pairComponentType(pairType, componentIndex);
        loadLocal(method, pairType, pairIndex);
        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/AbstractMap$SimpleEntry",
                componentIndex == 0 ? "getKey" : "getValue",
                "()Ljava/lang/Object;", false);
        if (componentType == ValueType.LONG) {
            unboxLong(method);
        } else {
            unboxInt(method);
        }
    }

    private static boolean isArrayListConstructor(String calleeText) {
        return "ArrayList".equals(calleeText) || calleeText.startsWith("ArrayList<");
    }

    private static boolean isMutableListFactory(String calleeText) {
        return "mutableListOf".equals(calleeText) || calleeText.startsWith("mutableListOf<");
    }

    private static ValueType arrayListTypeForFactoryOrConstructor(String calleeText, String expressionText) {
        ValueType type = arrayListTypeForFactoryOrConstructor(calleeText);
        if (type != null) {
            return type;
        }
        return arrayListTypeForFactoryOrConstructor(expressionText);
    }

    private static ValueType arrayListTypeForFactoryOrConstructor(String text) {
        String compact = compactCallablePrefix(text);
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.arrayListType != null
                    && (genericTypeEquals(compact, "ArrayList", shape.kotlinType)
                            || genericTypeEquals(compact, "mutableListOf", shape.kotlinType))) {
                return shape.arrayListType;
            }
        }
        for (PairShape shape : PairShape.values()) {
            if (genericTypeEquals(compact, "ArrayList", shape.kotlinType)
                    || genericTypeEquals(compact, "mutableListOf", shape.kotlinType)) {
                return shape.arrayListType;
            }
        }
        return null;
    }

    private static boolean isPriorityQueueConstructor(String calleeText) {
        return "PriorityQueue".equals(calleeText) || calleeText.startsWith("PriorityQueue<");
    }

    private static ValueType priorityQueueTypeForConstructor(String calleeText, String expressionText) {
        ValueType type = priorityQueueTypeForConstructor(calleeText);
        if (type != null) {
            return type;
        }
        return priorityQueueTypeForConstructor(expressionText);
    }

    private static ValueType priorityQueueTypeForConstructor(String text) {
        String compactExpression = compactText(text);
        if (compactExpression.startsWith("PriorityQueue<" + PairShape.INT_INT.kotlinType + ">(")
                && compactExpression.contains("compareBy")
                && compactExpression.contains("it.second")) {
            return ValueType.INT_PAIR_SECOND_PRIORITY_QUEUE;
        }
        String compact = compactCallablePrefix(text);
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.priorityQueueType != null
                    && genericTypeEquals(compact, "PriorityQueue", shape.kotlinType)) {
                return shape.priorityQueueType;
            }
        }
        for (PairShape shape : PairShape.values()) {
            if (shape.priorityQueueType != null
                    && genericTypeEquals(compact, "PriorityQueue", shape.kotlinType)) {
                return shape.priorityQueueType;
            }
        }
        return null;
    }

    private static boolean isIntPairPriorityQueueType(ValueType type) {
        PairShape shape = pairShapeForPriorityQueueType(type);
        return shape != null && shape.pairType == ValueType.INT_PAIR;
    }

    private static boolean isPairPriorityQueueType(ValueType type) {
        return pairShapeForPriorityQueueType(type) != null;
    }

    private static ValueType pairTypeForPriorityQueue(ValueType type) {
        PairShape shape = pairShapeForPriorityQueueType(type);
        if (shape != null) {
            return shape.pairType;
        }
        throw new IllegalArgumentException("Unsupported Pair PriorityQueue type: " + type);
    }

    private static boolean isSecondOrderIntPairPriorityQueue(ValueType type) {
        return type == ValueType.INT_PAIR_SECOND_PRIORITY_QUEUE;
    }

    private static boolean isArrayDequeConstructor(String calleeText) {
        return "ArrayDeque".equals(calleeText) || calleeText.startsWith("ArrayDeque<");
    }

    private static ValueType arrayDequeTypeForConstructor(String calleeText, String expressionText) {
        ValueType type = arrayDequeTypeForConstructor(calleeText);
        if (type != null) {
            return type;
        }
        return arrayDequeTypeForConstructor(expressionText);
    }

    private static ValueType arrayDequeTypeForConstructor(String text) {
        String compact = compactCallablePrefix(text);
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.arrayDequeType != null
                    && genericTypeEquals(compact, "ArrayDeque", shape.kotlinType)) {
                return shape.arrayDequeType;
            }
        }
        for (PairShape shape : PairShape.values()) {
            if (genericTypeEquals(compact, "ArrayDeque", shape.kotlinType)) {
                return shape.arrayDequeType;
            }
        }
        return null;
    }

    private static boolean isPairArrayDequeType(ValueType type) {
        return pairShapeForArrayDequeType(type) != null;
    }

    private static ValueType pairTypeForArrayDeque(ValueType type) {
        PairShape shape = pairShapeForArrayDequeType(type);
        if (shape != null) {
            return shape.pairType;
        }
        throw new IllegalArgumentException("Unsupported Pair ArrayDeque type: " + type);
    }

    private static boolean isHashSetConstructor(String calleeText) {
        return "HashSet".equals(calleeText) || calleeText.startsWith("HashSet<");
    }

    private static boolean isMutableSetFactory(String calleeText) {
        return "mutableSetOf".equals(calleeText) || calleeText.startsWith("mutableSetOf<");
    }

    private static ValueType hashSetTypeForFactoryOrConstructor(String calleeText, String expressionText) {
        ValueType type = hashSetTypeForFactoryOrConstructor(calleeText);
        if (type != null) {
            return type;
        }
        return hashSetTypeForFactoryOrConstructor(expressionText);
    }

    private static ValueType hashSetTypeForFactoryOrConstructor(String text) {
        String compact = compactCallablePrefix(text);
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.hashSetType != null
                    && (genericTypeEquals(compact, "HashSet", shape.kotlinType)
                            || genericTypeEquals(compact, "mutableSetOf", shape.kotlinType))) {
                return shape.hashSetType;
            }
        }
        return null;
    }

    private static boolean isHashMapConstructor(String calleeText) {
        return "HashMap".equals(calleeText) || calleeText.startsWith("HashMap<");
    }

    private static boolean isMutableMapFactory(String calleeText) {
        return "mutableMapOf".equals(calleeText) || calleeText.startsWith("mutableMapOf<");
    }

    private static ValueType hashMapTypeForFactoryOrConstructor(String calleeText, String expressionText) {
        ValueType type = hashMapTypeForFactoryOrConstructor(calleeText);
        if (type != null) {
            return type;
        }
        return hashMapTypeForFactoryOrConstructor(expressionText);
    }

    private static ValueType hashMapTypeForFactoryOrConstructor(String text) {
        String compact = compactCallablePrefix(text);
        for (MapShape shape : MapShape.values()) {
            if (genericTypeEquals(compact, "HashMap", shape.kotlinType)
                    || genericTypeEquals(compact, "mutableMapOf", shape.kotlinType)) {
                return shape.mapType;
            }
        }
        return null;
    }

    private static boolean isHashMapType(ValueType type) {
        return mapShapeForMapType(type) != null;
    }

    private static ValueType hashMapKeyType(ValueType type) {
        MapShape shape = mapShapeForMapType(type);
        if (shape == null) {
            throw new IllegalArgumentException("Unsupported HashMap type: " + type);
        }
        return shape.keyType;
    }

    private static ValueType hashMapValueType(ValueType type) {
        MapShape shape = mapShapeForMapType(type);
        if (shape == null) {
            throw new IllegalArgumentException("Unsupported HashMap type: " + type);
        }
        return shape.valueType;
    }

    private static PairShape pairShapeForPairType(ValueType type) {
        for (PairShape shape : PairShape.values()) {
            if (shape.pairType == type) {
                return shape;
            }
        }
        return null;
    }

    private static PairShape pairShapeForArrayListType(ValueType type) {
        for (PairShape shape : PairShape.values()) {
            if (shape.arrayListType == type) {
                return shape;
            }
        }
        return null;
    }

    private static PairShape pairShapeForArrayListArrayType(ValueType type) {
        for (PairShape shape : PairShape.values()) {
            if (shape.arrayListArrayType == type) {
                return shape;
            }
        }
        return null;
    }

    private static PairShape pairShapeForArrayDequeType(ValueType type) {
        for (PairShape shape : PairShape.values()) {
            if (shape.arrayDequeType == type) {
                return shape;
            }
        }
        return null;
    }

    private static PairShape pairShapeForPriorityQueueType(ValueType type) {
        for (PairShape shape : PairShape.values()) {
            if (shape.priorityQueueType == type || shape.secondPriorityQueueType == type) {
                return shape;
            }
        }
        return null;
    }

    private static MapShape mapShapeForMapType(ValueType type) {
        for (MapShape shape : MapShape.values()) {
            if (shape.mapType == type) {
                return shape;
            }
        }
        return null;
    }

    private static ValueType pairTypeFromComponents(ValueType firstType, ValueType secondType) {
        for (PairShape shape : PairShape.values()) {
            if (shape.firstType == firstType && shape.secondType == secondType) {
                return shape.pairType;
            }
        }
        throw new IllegalArgumentException("Unsupported Pair component types: " + firstType + ", " + secondType);
    }

    private static ValueType pairTypeFromText(String text) {
        String compact = compactText(text);
        for (PairShape shape : PairShape.values()) {
            if (shape.kotlinType.equals(compact)) {
                return shape.pairType;
            }
        }
        return null;
    }

    private static ValueType arrayListTypeFromText(String text) {
        String compact = compactText(text);
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.arrayListType != null
                    && (genericTypeEquals(compact, "ArrayList", shape.kotlinType)
                            || genericTypeEquals(compact, "MutableList", shape.kotlinType)
                            || genericTypeEquals(compact, "List", shape.kotlinType))) {
                return shape.arrayListType;
            }
        }
        for (PairShape shape : PairShape.values()) {
            if (genericTypeEquals(compact, "ArrayList", shape.kotlinType)
                    || genericTypeEquals(compact, "MutableList", shape.kotlinType)
                    || genericTypeEquals(compact, "List", shape.kotlinType)) {
                return shape.arrayListType;
            }
        }
        return null;
    }

    private static ValueType arrayListArrayTypeFromText(String text) {
        String compact = compactText(text);
        if ("Array<ArrayList<Int>>".equals(compact) || "Array<MutableList<Int>>".equals(compact)
                || "Array<List<Int>>".equals(compact)) {
            return ValueType.INT_ARRAY_LIST_ARRAY;
        }
        for (PairShape shape : PairShape.values()) {
            if (genericTypeEquals(compact, "Array", "ArrayList<" + shape.kotlinType + ">")
                    || genericTypeEquals(compact, "Array", "MutableList<" + shape.kotlinType + ">")
                    || genericTypeEquals(compact, "Array", "List<" + shape.kotlinType + ">")) {
                return shape.arrayListArrayType;
            }
        }
        return null;
    }

    private static ValueType priorityQueueTypeFromText(String text) {
        String compact = compactText(text);
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.priorityQueueType != null
                    && genericTypeEquals(compact, "PriorityQueue", shape.kotlinType)) {
                return shape.priorityQueueType;
            }
        }
        for (PairShape shape : PairShape.values()) {
            if (shape.priorityQueueType != null
                    && genericTypeEquals(compact, "PriorityQueue", shape.kotlinType)) {
                return shape.priorityQueueType;
            }
        }
        return null;
    }

    private static ValueType arrayDequeTypeFromText(String text) {
        String compact = compactText(text);
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.arrayDequeType != null
                    && genericTypeEquals(compact, "ArrayDeque", shape.kotlinType)) {
                return shape.arrayDequeType;
            }
        }
        for (PairShape shape : PairShape.values()) {
            if (genericTypeEquals(compact, "ArrayDeque", shape.kotlinType)) {
                return shape.arrayDequeType;
            }
        }
        return null;
    }

    private static ValueType hashSetTypeFromText(String text) {
        String compact = compactText(text);
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.hashSetType != null
                    && (genericTypeEquals(compact, "HashSet", shape.kotlinType)
                            || genericTypeEquals(compact, "MutableSet", shape.kotlinType)
                            || genericTypeEquals(compact, "Set", shape.kotlinType))) {
                return shape.hashSetType;
            }
        }
        return null;
    }

    private static ValueType hashMapTypeFromText(String text) {
        String compact = compactText(text);
        for (MapShape shape : MapShape.values()) {
            if (genericTypeEquals(compact, "HashMap", shape.kotlinType)
                    || genericTypeEquals(compact, "MutableMap", shape.kotlinType)
                    || genericTypeEquals(compact, "Map", shape.kotlinType)) {
                return shape.mapType;
            }
        }
        return null;
    }

    private static PrimitiveArrayShape primitiveArrayShapeForArrayType(ValueType type) {
        for (PrimitiveArrayShape shape : PrimitiveArrayShape.values()) {
            if (shape.arrayType == type) {
                return shape;
            }
        }
        return null;
    }

    private static PrimitiveArrayShape primitiveArrayShapeForArrayArrayType(ValueType type) {
        for (PrimitiveArrayShape shape : PrimitiveArrayShape.values()) {
            if (shape.arrayArrayType == type) {
                return shape;
            }
        }
        return null;
    }

    private static PrimitiveArrayShape primitiveArrayShapeFromKotlinType(String text) {
        String compact = compactText(text);
        for (PrimitiveArrayShape shape : PrimitiveArrayShape.values()) {
            if (shape.kotlinType.equals(compact)) {
                return shape;
            }
        }
        return null;
    }

    private static PrimitiveArrayShape primitiveArrayShapeFromArrayKotlinType(String text) {
        String compact = compactText(text);
        for (PrimitiveArrayShape shape : PrimitiveArrayShape.values()) {
            if (genericTypeEquals(compact, "Array", shape.kotlinType)) {
                return shape;
            }
        }
        return null;
    }

    private static ScalarCollectionShape scalarCollectionShapeForType(ValueType type) {
        for (ScalarCollectionShape shape : ScalarCollectionShape.values()) {
            if (shape.arrayListType == type || shape.priorityQueueType == type
                    || shape.arrayDequeType == type || shape.hashSetType == type) {
                return shape;
            }
        }
        return null;
    }

    private static String scalarCollectionOwner(ValueType type) {
        ScalarCollectionShape shape = scalarCollectionShapeForType(type);
        if (shape == null) {
            return null;
        }
        if (shape.arrayListType == type) {
            return "java/util/ArrayList";
        }
        if (shape.priorityQueueType == type) {
            return "java/util/PriorityQueue";
        }
        if (shape.arrayDequeType == type) {
            return "java/util/ArrayDeque";
        }
        if (shape.hashSetType == type) {
            return "java/util/HashSet";
        }
        return null;
    }

    private static String scalarOfferOwner(ValueType type) {
        ScalarCollectionShape shape = scalarCollectionShapeForType(type);
        if (shape == null) {
            return null;
        }
        if (shape.priorityQueueType == type) {
            return "java/util/PriorityQueue";
        }
        if (shape.arrayDequeType == type) {
            return "java/util/ArrayDeque";
        }
        return null;
    }

    private static String scalarArrayListOwner(ValueType type) {
        ScalarCollectionShape shape = scalarCollectionShapeForType(type);
        if (shape != null && shape.arrayListType == type) {
            return "java/util/ArrayList";
        }
        return null;
    }

    private static String scalarDequeOwner(ValueType type) {
        ScalarCollectionShape shape = scalarCollectionShapeForType(type);
        if (shape != null && shape.arrayDequeType == type) {
            return "java/util/ArrayDeque";
        }
        return null;
    }

    private static String sizedCollectionOwner(ValueType type) {
        String owner = scalarCollectionOwner(type);
        if (owner != null) {
            return owner;
        }
        if (isPairArrayListType(type)) {
            return "java/util/ArrayList";
        }
        if (isPairPriorityQueueType(type)) {
            return "java/util/PriorityQueue";
        }
        if (isPairArrayDequeType(type)) {
            return "java/util/ArrayDeque";
        }
        if (isHashMapType(type)) {
            return "java/util/HashMap";
        }
        return null;
    }

    private static boolean genericTypeEquals(String compactText, String typeName, String typeArguments) {
        return (typeName + "<" + typeArguments + ">").equals(compactText);
    }

    private static String compactCallablePrefix(String text) {
        String compact = compactText(text);
        int parenIndex = compact.indexOf('(');
        if (parenIndex >= 0) {
            compact = compact.substring(0, parenIndex);
        }
        return compact;
    }

    private static String compactText(String text) {
        return text == null ? "" : text.replace(" ", "");
    }

    private static void boxInt(MethodVisitor method) {
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Integer", "valueOf",
                "(I)Ljava/lang/Integer;", false);
    }

    private static void unboxInt(MethodVisitor method) {
        method.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/Integer");
        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/Integer", "intValue", "()I", false);
    }

    private static void boxLong(MethodVisitor method) {
        method.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Long", "valueOf",
                "(J)Ljava/lang/Long;", false);
    }

    private static void unboxLong(MethodVisitor method) {
        method.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/Long");
        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/Long", "longValue", "()J", false);
    }

    private static void emitBoxedExpressionAs(
            MethodVisitor method, MethodContext context, KtExpression expression, ValueType type) {
        emitExpressionAs(method, context, expression, type);
        boxValue(method, type);
    }

    private static void boxValue(MethodVisitor method, ValueType type) {
        if (type == ValueType.INT) {
            boxInt(method);
            return;
        }
        if (type == ValueType.LONG) {
            boxLong(method);
            return;
        }
        if (type == ValueType.STRING) {
            return;
        }
        throw new IllegalArgumentException("Unsupported boxed value type: " + type);
    }

    private static void unboxValue(MethodVisitor method, ValueType type) {
        if (type == ValueType.INT) {
            unboxInt(method);
            return;
        }
        if (type == ValueType.LONG) {
            unboxLong(method);
            return;
        }
        if (type == ValueType.STRING) {
            method.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/String");
            return;
        }
        throw new IllegalArgumentException("Unsupported unboxed value type: " + type);
    }

    private static void emitPackedIntPair(
            MethodVisitor method, MethodContext context, KtExpression expression, boolean orderBySecond) {
        emitExpressionAs(method, context, expression, ValueType.INT_PAIR);
        int pairIndex = context.allocateTemporary(ValueType.INT_PAIR);
        method.visitVarInsn(Opcodes.ASTORE, pairIndex);

        method.visitVarInsn(Opcodes.ALOAD, pairIndex);
        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/AbstractMap$SimpleEntry",
                orderBySecond ? "getValue" : "getKey",
                "()Ljava/lang/Object;", false);
        unboxInt(method);
        method.visitInsn(Opcodes.I2L);
        method.visitLdcInsn(32);
        method.visitInsn(Opcodes.LSHL);

        method.visitVarInsn(Opcodes.ALOAD, pairIndex);
        method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/AbstractMap$SimpleEntry",
                orderBySecond ? "getKey" : "getValue",
                "()Ljava/lang/Object;", false);
        unboxInt(method);
        method.visitLdcInsn(Integer.MIN_VALUE);
        method.visitInsn(Opcodes.IXOR);
        method.visitInsn(Opcodes.I2L);
        method.visitLdcInsn(0xffffffffL);
        method.visitInsn(Opcodes.LAND);
        method.visitInsn(Opcodes.LOR);
    }

    private static void emitIntPairFromPackedLong(MethodVisitor method, MethodContext context, boolean orderBySecond) {
        int packedIndex = context.allocateTemporary(ValueType.LONG);
        method.visitVarInsn(Opcodes.LSTORE, packedIndex);
        method.visitTypeInsn(Opcodes.NEW, "java/util/AbstractMap$SimpleEntry");
        method.visitInsn(Opcodes.DUP);
        if (orderBySecond) {
            method.visitVarInsn(Opcodes.LLOAD, packedIndex);
            method.visitInsn(Opcodes.L2I);
            method.visitLdcInsn(Integer.MIN_VALUE);
            method.visitInsn(Opcodes.IXOR);
            boxInt(method);
            method.visitVarInsn(Opcodes.LLOAD, packedIndex);
            method.visitLdcInsn(32);
            method.visitInsn(Opcodes.LSHR);
            method.visitInsn(Opcodes.L2I);
            boxInt(method);
        } else {
            method.visitVarInsn(Opcodes.LLOAD, packedIndex);
            method.visitLdcInsn(32);
            method.visitInsn(Opcodes.LSHR);
            method.visitInsn(Opcodes.L2I);
            boxInt(method);
            method.visitVarInsn(Opcodes.LLOAD, packedIndex);
            method.visitInsn(Opcodes.L2I);
            method.visitLdcInsn(Integer.MIN_VALUE);
            method.visitInsn(Opcodes.IXOR);
            boxInt(method);
        }
        method.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/util/AbstractMap$SimpleEntry", "<init>",
                "(Ljava/lang/Object;Ljava/lang/Object;)V", false);
    }

    private static void emitPackedLongIntPair(MethodVisitor method, MethodContext context, KtExpression expression) {
        ensureLongIntPairPriorityQueueHelpers(context);
        emitExpressionAs(method, context, expression, ValueType.LONG_INT_PAIR);
        method.visitMethodInsn(Opcodes.INVOKESTATIC, context.ownerInternalName,
                "__wasmIdlePackLongIntPair", "(Ljava/util/AbstractMap$SimpleEntry;)Ljava/lang/String;", false);
    }

    private static void emitPackedPairPriorityQueueElement(
            MethodVisitor method, MethodContext context, KtExpression expression, ValueType queueType) {
        if (isIntPairPriorityQueueType(queueType)) {
            emitPackedIntPair(method, context, expression, isSecondOrderIntPairPriorityQueue(queueType));
            boxLong(method);
            return;
        }
        if (queueType == ValueType.LONG_INT_PAIR_PRIORITY_QUEUE) {
            emitPackedLongIntPair(method, context, expression);
            return;
        }
        throw new IllegalArgumentException("Unsupported Pair PriorityQueue type: " + queueType);
    }

    private static ValueType emitPairFromPackedPriorityQueueElement(
            MethodVisitor method, MethodContext context, ValueType queueType) {
        if (isIntPairPriorityQueueType(queueType)) {
            unboxLong(method);
            emitIntPairFromPackedLong(method, context, isSecondOrderIntPairPriorityQueue(queueType));
            return ValueType.INT_PAIR;
        }
        if (queueType == ValueType.LONG_INT_PAIR_PRIORITY_QUEUE) {
            emitLongIntPairFromPackedString(method, context);
            return ValueType.LONG_INT_PAIR;
        }
        throw new IllegalArgumentException("Unsupported Pair PriorityQueue type: " + queueType);
    }

    private static void emitLongIntPairFromPackedString(MethodVisitor method, MethodContext context) {
        ensureLongIntPairPriorityQueueHelpers(context);
        method.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/String");
        method.visitMethodInsn(Opcodes.INVOKESTATIC, context.ownerInternalName,
                "__wasmIdleLongIntPairFromPacked", "(Ljava/lang/String;)Ljava/util/AbstractMap$SimpleEntry;",
                false);
    }

    private static void ensureLongIntPairPriorityQueueHelpers(MethodContext context) {
        String key = context.ownerInternalName + ".__wasmIdleLongIntPairPriorityQueue";
        if (!generatedHelpers.add(key)) {
            return;
        }

        MethodVisitor pack = context.builder.newMethod(
                JvmDeclarationOrigin.NO_ORIGIN,
                Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC,
                "__wasmIdlePackLongIntPair",
                "(Ljava/util/AbstractMap$SimpleEntry;)Ljava/lang/String;",
                null,
                new String[0]);
        pack.visitCode();
        pack.visitVarInsn(Opcodes.ALOAD, 0);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/AbstractMap$SimpleEntry",
                "getKey", "()Ljava/lang/Object;", false);
        unboxLong(pack);
        pack.visitLdcInsn(Long.MIN_VALUE);
        pack.visitInsn(Opcodes.LXOR);
        pack.visitVarInsn(Opcodes.LSTORE, 1);
        pack.visitVarInsn(Opcodes.ALOAD, 0);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/AbstractMap$SimpleEntry",
                "getValue", "()Ljava/lang/Object;", false);
        unboxInt(pack);
        pack.visitLdcInsn(Integer.MIN_VALUE);
        pack.visitInsn(Opcodes.IXOR);
        pack.visitVarInsn(Opcodes.ISTORE, 3);
        pack.visitTypeInsn(Opcodes.NEW, "java/lang/StringBuilder");
        pack.visitInsn(Opcodes.DUP);
        pack.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/StringBuilder", "<init>", "()V", false);
        pack.visitVarInsn(Opcodes.ASTORE, 4);
        pack.visitVarInsn(Opcodes.LLOAD, 1);
        pack.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Long", "toHexString",
                "(J)Ljava/lang/String;", false);
        pack.visitVarInsn(Opcodes.ASTORE, 5);
        pack.visitIntInsn(Opcodes.BIPUSH, 16);
        pack.visitVarInsn(Opcodes.ALOAD, 5);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length", "()I", false);
        pack.visitInsn(Opcodes.ISUB);
        pack.visitVarInsn(Opcodes.ISTORE, 6);
        Label longPadStart = new Label();
        Label longPadEnd = new Label();
        pack.visitLabel(longPadStart);
        pack.visitVarInsn(Opcodes.ILOAD, 6);
        pack.visitJumpInsn(Opcodes.IFLE, longPadEnd);
        pack.visitVarInsn(Opcodes.ALOAD, 4);
        pack.visitIntInsn(Opcodes.BIPUSH, 48);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                "(C)Ljava/lang/StringBuilder;", false);
        pack.visitInsn(Opcodes.POP);
        pack.visitIincInsn(6, -1);
        pack.visitJumpInsn(Opcodes.GOTO, longPadStart);
        pack.visitLabel(longPadEnd);
        pack.visitVarInsn(Opcodes.ALOAD, 4);
        pack.visitVarInsn(Opcodes.ALOAD, 5);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
        pack.visitInsn(Opcodes.POP);
        pack.visitVarInsn(Opcodes.ILOAD, 3);
        pack.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Integer", "toHexString",
                "(I)Ljava/lang/String;", false);
        pack.visitVarInsn(Opcodes.ASTORE, 5);
        pack.visitIntInsn(Opcodes.BIPUSH, 8);
        pack.visitVarInsn(Opcodes.ALOAD, 5);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "length", "()I", false);
        pack.visitInsn(Opcodes.ISUB);
        pack.visitVarInsn(Opcodes.ISTORE, 6);
        Label intPadStart = new Label();
        Label intPadEnd = new Label();
        pack.visitLabel(intPadStart);
        pack.visitVarInsn(Opcodes.ILOAD, 6);
        pack.visitJumpInsn(Opcodes.IFLE, intPadEnd);
        pack.visitVarInsn(Opcodes.ALOAD, 4);
        pack.visitIntInsn(Opcodes.BIPUSH, 48);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                "(C)Ljava/lang/StringBuilder;", false);
        pack.visitInsn(Opcodes.POP);
        pack.visitIincInsn(6, -1);
        pack.visitJumpInsn(Opcodes.GOTO, intPadStart);
        pack.visitLabel(intPadEnd);
        pack.visitVarInsn(Opcodes.ALOAD, 4);
        pack.visitVarInsn(Opcodes.ALOAD, 5);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "append",
                "(Ljava/lang/String;)Ljava/lang/StringBuilder;", false);
        pack.visitInsn(Opcodes.POP);
        pack.visitVarInsn(Opcodes.ALOAD, 4);
        pack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/StringBuilder", "toString",
                "()Ljava/lang/String;", false);
        pack.visitInsn(Opcodes.ARETURN);
        pack.visitMaxs(6, 7);
        pack.visitEnd();

        MethodVisitor unpack = context.builder.newMethod(
                JvmDeclarationOrigin.NO_ORIGIN,
                Opcodes.ACC_PRIVATE | Opcodes.ACC_STATIC,
                "__wasmIdleLongIntPairFromPacked",
                "(Ljava/lang/String;)Ljava/util/AbstractMap$SimpleEntry;",
                null,
                new String[0]);
        unpack.visitCode();
        unpack.visitVarInsn(Opcodes.ALOAD, 0);
        unpack.visitInsn(Opcodes.ICONST_0);
        unpack.visitIntInsn(Opcodes.BIPUSH, 16);
        unpack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "substring",
                "(II)Ljava/lang/String;", false);
        unpack.visitIntInsn(Opcodes.BIPUSH, 16);
        unpack.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Long", "parseUnsignedLong",
                "(Ljava/lang/String;I)J", false);
        unpack.visitLdcInsn(Long.MIN_VALUE);
        unpack.visitInsn(Opcodes.LXOR);
        unpack.visitVarInsn(Opcodes.LSTORE, 1);
        unpack.visitVarInsn(Opcodes.ALOAD, 0);
        unpack.visitIntInsn(Opcodes.BIPUSH, 16);
        unpack.visitIntInsn(Opcodes.BIPUSH, 24);
        unpack.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "substring",
                "(II)Ljava/lang/String;", false);
        unpack.visitIntInsn(Opcodes.BIPUSH, 16);
        unpack.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Long", "parseLong",
                "(Ljava/lang/String;I)J", false);
        unpack.visitInsn(Opcodes.L2I);
        unpack.visitLdcInsn(Integer.MIN_VALUE);
        unpack.visitInsn(Opcodes.IXOR);
        unpack.visitVarInsn(Opcodes.ISTORE, 3);
        unpack.visitTypeInsn(Opcodes.NEW, "java/util/AbstractMap$SimpleEntry");
        unpack.visitInsn(Opcodes.DUP);
        unpack.visitVarInsn(Opcodes.LLOAD, 1);
        boxLong(unpack);
        unpack.visitVarInsn(Opcodes.ILOAD, 3);
        boxInt(unpack);
        unpack.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/util/AbstractMap$SimpleEntry", "<init>",
                "(Ljava/lang/Object;Ljava/lang/Object;)V", false);
        unpack.visitInsn(Opcodes.ARETURN);
        unpack.visitMaxs(6, 4);
        unpack.visitEnd();
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
            if (isContainsOperation(operation)) {
                emitContainsExpression(method, context, binary);
                method.visitJumpInsn(jumpWhenTrue ? Opcodes.IFNE : Opcodes.IFEQ, target);
                return;
            }
            if (isComparison(operation)) {
                ValueType leftType = inferExpressionType(context, binary.getLeft());
                ValueType rightType = inferExpressionType(context, binary.getRight());
                if (leftType == ValueType.STRING && rightType == ValueType.STRING
                        && isEqualityComparison(operation)) {
                    emitExpressionAs(method, context, binary.getLeft(), ValueType.STRING);
                    emitExpressionAs(method, context, binary.getRight(), ValueType.STRING);
                    method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "equals",
                            "(Ljava/lang/Object;)Z", false);
                    method.visitJumpInsn(stringEqualityOpcode(operation, jumpWhenTrue), target);
                    return;
                }
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

    private static ValueType emitContainsExpression(
            MethodVisitor method, MethodContext context, KtBinaryExpression binary) {
        KtExpression element = binary.getLeft();
        KtExpression container = binary.getRight();
        if (element == null || container == null) {
            throw new IllegalArgumentException("Missing in-expression operand: " + binary.getText());
        }
        boolean negated = binary.getOperationToken() == KtTokens.NOT_IN;

        if (container instanceof KtBinaryExpression) {
            KtBinaryExpression rangeExpression = (KtBinaryExpression) container;
            String rangeOperation = rangeExpression.getOperationReference().getText();
            if ("until".equals(rangeOperation) || "..<".equals(rangeOperation)
                    || "..".equals(rangeOperation) || "downTo".equals(rangeOperation)) {
                ValueType elementType = inferExpressionType(context, element);
                if (elementType != ValueType.INT) {
                    throw new IllegalArgumentException("Range contains only supports Int: " + binary.getText());
                }
                int valueIndex = context.allocateTemporary(ValueType.INT);
                emitExpressionAs(method, context, element, ValueType.INT);
                method.visitVarInsn(Opcodes.ISTORE, valueIndex);
                Label falseLabel = new Label();
                Label endLabel = new Label();
                if ("downTo".equals(rangeOperation)) {
                    method.visitVarInsn(Opcodes.ILOAD, valueIndex);
                    emitExpressionAs(method, context, rangeExpression.getLeft(), ValueType.INT);
                    method.visitJumpInsn(Opcodes.IF_ICMPGT, falseLabel);
                    method.visitVarInsn(Opcodes.ILOAD, valueIndex);
                    emitExpressionAs(method, context, rangeExpression.getRight(), ValueType.INT);
                    method.visitJumpInsn(Opcodes.IF_ICMPLT, falseLabel);
                } else {
                    method.visitVarInsn(Opcodes.ILOAD, valueIndex);
                    emitExpressionAs(method, context, rangeExpression.getLeft(), ValueType.INT);
                    method.visitJumpInsn(Opcodes.IF_ICMPLT, falseLabel);
                    method.visitVarInsn(Opcodes.ILOAD, valueIndex);
                    emitExpressionAs(method, context, rangeExpression.getRight(), ValueType.INT);
                    method.visitJumpInsn("..".equals(rangeOperation) ? Opcodes.IF_ICMPGT : Opcodes.IF_ICMPGE,
                            falseLabel);
                }
                method.visitInsn(negated ? Opcodes.ICONST_0 : Opcodes.ICONST_1);
                method.visitJumpInsn(Opcodes.GOTO, endLabel);
                method.visitLabel(falseLabel);
                method.visitInsn(negated ? Opcodes.ICONST_1 : Opcodes.ICONST_0);
                method.visitLabel(endLabel);
                return ValueType.BOOLEAN;
            }
        }

        ValueType containerType = inferExpressionType(context, container);
        ValueType elementType = inferExpressionType(context, element);
        if (containerType == ValueType.STRING) {
            emitExpressionAs(method, context, container, ValueType.STRING);
            if (elementType == ValueType.CHAR) {
                emitExpressionAs(method, context, element, ValueType.CHAR);
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "indexOf", "(I)I", false);
                method.visitInsn(Opcodes.ICONST_M1);
                Label trueLabel = new Label();
                Label endLabel = new Label();
                method.visitJumpInsn(negated ? Opcodes.IF_ICMPEQ : Opcodes.IF_ICMPNE, trueLabel);
                method.visitInsn(Opcodes.ICONST_0);
                method.visitJumpInsn(Opcodes.GOTO, endLabel);
                method.visitLabel(trueLabel);
                method.visitInsn(Opcodes.ICONST_1);
                method.visitLabel(endLabel);
                return ValueType.BOOLEAN;
            }
            if (elementType == ValueType.STRING) {
                emitExpressionAs(method, context, element, ValueType.STRING);
                method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "contains",
                        "(Ljava/lang/CharSequence;)Z", false);
                if (negated) {
                    method.visitInsn(Opcodes.ICONST_1);
                    method.visitInsn(Opcodes.IXOR);
                }
                return ValueType.BOOLEAN;
            }
        }
        PrimitiveArrayShape primitiveArrayShape = primitiveArrayShapeForArrayType(containerType);
        if (primitiveArrayShape != null) {
            ValueType arrayElementType = primitiveArrayShape.elementType;
            if (elementType != arrayElementType) {
                throw new IllegalArgumentException("Array contains type mismatch: " + binary.getText());
            }
            int arrayIndex = context.allocateTemporary(containerType);
            emitExpressionAs(method, context, container, containerType);
            method.visitVarInsn(Opcodes.ASTORE, arrayIndex);
            int valueIndex = context.allocateTemporary(arrayElementType);
            emitExpressionAs(method, context, element, arrayElementType);
            storeLocal(method, arrayElementType, valueIndex);
            int loopIndex = context.allocateTemporary(ValueType.INT);
            method.visitInsn(Opcodes.ICONST_0);
            method.visitVarInsn(Opcodes.ISTORE, loopIndex);

            Label startLabel = new Label();
            Label foundLabel = new Label();
            Label missingLabel = new Label();
            Label endLabel = new Label();
            method.visitLabel(startLabel);
            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
            method.visitVarInsn(Opcodes.ALOAD, arrayIndex);
            method.visitInsn(Opcodes.ARRAYLENGTH);
            method.visitJumpInsn(Opcodes.IF_ICMPGE, missingLabel);
            method.visitVarInsn(Opcodes.ALOAD, arrayIndex);
            method.visitVarInsn(Opcodes.ILOAD, loopIndex);
            method.visitInsn(primitiveArrayShape.loadOpcode);
            loadLocal(method, arrayElementType, valueIndex);
            if (arrayElementType == ValueType.LONG) {
                method.visitInsn(Opcodes.LCMP);
                method.visitJumpInsn(Opcodes.IFEQ, foundLabel);
            } else if (arrayElementType == ValueType.DOUBLE) {
                method.visitInsn(Opcodes.DCMPL);
                method.visitJumpInsn(Opcodes.IFEQ, foundLabel);
            } else {
                method.visitJumpInsn(Opcodes.IF_ICMPEQ, foundLabel);
            }
            method.visitIincInsn(loopIndex, 1);
            method.visitJumpInsn(Opcodes.GOTO, startLabel);
            method.visitLabel(foundLabel);
            method.visitInsn(negated ? Opcodes.ICONST_0 : Opcodes.ICONST_1);
            method.visitJumpInsn(Opcodes.GOTO, endLabel);
            method.visitLabel(missingLabel);
            method.visitInsn(negated ? Opcodes.ICONST_1 : Opcodes.ICONST_0);
            method.visitLabel(endLabel);
            return ValueType.BOOLEAN;
        }
        if (isHashMapType(containerType)) {
            ValueType keyType = hashMapKeyType(containerType);
            if (elementType != keyType) {
                throw new IllegalArgumentException("Map contains requires key type " + keyType + ": "
                        + binary.getText());
            }
            emitExpression(method, context, container);
            emitBoxedExpressionAs(method, context, element, keyType);
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/HashMap", "containsKey",
                    "(Ljava/lang/Object;)Z", false);
            if (negated) {
                method.visitInsn(Opcodes.ICONST_1);
                method.visitInsn(Opcodes.IXOR);
            }
            return ValueType.BOOLEAN;
        }
        ScalarCollectionShape scalarShape = scalarCollectionShapeForType(containerType);
        String scalarOwner = scalarCollectionOwner(containerType);
        if (scalarShape != null && scalarOwner != null) {
            if (elementType != scalarShape.elementType) {
                throw new IllegalArgumentException(scalarShape.kotlinType
                        + " collection contains requires " + scalarShape.kotlinType + " element: "
                        + binary.getText());
            }
            emitExpression(method, context, container);
            emitExpressionAs(method, context, element, scalarShape.elementType);
            boxValue(method, scalarShape.elementType);
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, scalarOwner, "contains",
                    "(Ljava/lang/Object;)Z", false);
            if (negated) {
                method.visitInsn(Opcodes.ICONST_1);
                method.visitInsn(Opcodes.IXOR);
            }
            return ValueType.BOOLEAN;
        }
        if (isPairArrayListType(containerType)) {
            ValueType pairType = pairTypeForArrayList(containerType);
            if (elementType != pairType) {
                throw new IllegalArgumentException("Pair list contains type mismatch: " + binary.getText());
            }
            emitExpression(method, context, container);
            emitExpressionAs(method, context, element, pairType);
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayList", "contains",
                    "(Ljava/lang/Object;)Z", false);
            if (negated) {
                method.visitInsn(Opcodes.ICONST_1);
                method.visitInsn(Opcodes.IXOR);
            }
            return ValueType.BOOLEAN;
        }
        if (isPairArrayDequeType(containerType)) {
            ValueType pairType = pairTypeForArrayDeque(containerType);
            if (elementType != pairType) {
                throw new IllegalArgumentException("Pair deque contains type mismatch: " + binary.getText());
            }
            emitExpression(method, context, container);
            emitExpressionAs(method, context, element, pairType);
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/ArrayDeque", "contains",
                    "(Ljava/lang/Object;)Z", false);
            if (negated) {
                method.visitInsn(Opcodes.ICONST_1);
                method.visitInsn(Opcodes.IXOR);
            }
            return ValueType.BOOLEAN;
        }
        if (isPairPriorityQueueType(containerType)) {
            ValueType pairType = pairTypeForPriorityQueue(containerType);
            if (elementType != pairType) {
                throw new IllegalArgumentException("Pair priority queue contains requires " + pairType + " element: "
                        + binary.getText());
            }
            emitExpression(method, context, container);
            emitPackedPairPriorityQueueElement(method, context, element, containerType);
            method.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/PriorityQueue", "contains",
                    "(Ljava/lang/Object;)Z", false);
            if (negated) {
                method.visitInsn(Opcodes.ICONST_1);
                method.visitInsn(Opcodes.IXOR);
            }
            return ValueType.BOOLEAN;
        }
        throw new IllegalArgumentException("Unsupported in-expression: " + binary.getText());
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

    private static boolean isContainsOperation(IElementType operation) {
        return operation == KtTokens.IN_KEYWORD || operation == KtTokens.NOT_IN;
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

    private static int stringEqualityOpcode(IElementType operation, boolean jumpWhenTrue) {
        boolean equalityOperation = operation == KtTokens.EQEQ || operation == KtTokens.EQEQEQ;
        return equalityOperation == jumpWhenTrue ? Opcodes.IFNE : Opcodes.IFEQ;
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
        ValueType parsedType = arrayListTypeFromText(text);
        if (parsedType != null) {
            return parsedType;
        }
        parsedType = arrayListArrayTypeFromText(text);
        if (parsedType != null) {
            return parsedType;
        }
        parsedType = priorityQueueTypeFromText(text);
        if (parsedType != null) {
            return parsedType;
        }
        parsedType = arrayDequeTypeFromText(text);
        if (parsedType != null) {
            return parsedType;
        }
        parsedType = hashSetTypeFromText(text);
        if (parsedType != null) {
            return parsedType;
        }
        parsedType = hashMapTypeFromText(text);
        if (parsedType != null) {
            return parsedType;
        }
        parsedType = pairTypeFromText(text);
        if (parsedType != null) {
            return parsedType;
        }
        if ("Char".equals(text)) {
            return ValueType.CHAR;
        }
        if ("Boolean".equals(text)) {
            return ValueType.BOOLEAN;
        }
        PrimitiveArrayShape primitiveArrayShape = primitiveArrayShapeFromKotlinType(text);
        if (primitiveArrayShape != null) {
            return primitiveArrayShape.arrayType;
        }
        primitiveArrayShape = primitiveArrayShapeFromArrayKotlinType(text);
        if (primitiveArrayShape != null) {
            return primitiveArrayShape.arrayArrayType;
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

    private static ValueType numericAggregateType(ValueType receiverType) {
        PrimitiveArrayShape primitiveShape = primitiveArrayShapeForArrayType(receiverType);
        if (primitiveShape != null && primitiveShape.elementType.numeric) {
            return primitiveShape.elementType;
        }
        if (receiverType == ValueType.INT_ARRAY_LIST) {
            return ValueType.INT;
        }
        if (receiverType == ValueType.LONG_ARRAY_LIST) {
            return ValueType.LONG;
        }
        return null;
    }

    private static boolean isSortablePrimitiveArrayType(ValueType type) {
        PrimitiveArrayShape shape = primitiveArrayShapeForArrayType(type);
        return shape != null && shape.sortable;
    }

    private static boolean isReversiblePrimitiveArrayType(ValueType type) {
        return primitiveArrayShapeForArrayType(type) != null;
    }

    private static boolean isSortableArrayListType(ValueType type) {
        return type == ValueType.INT_ARRAY_LIST || type == ValueType.LONG_ARRAY_LIST
                || type == ValueType.STRING_ARRAY_LIST;
    }

    private static boolean isReversibleArrayListType(ValueType type) {
        return isSortableArrayListType(type) || isPairArrayListType(type);
    }

    private static ForProgression parseForProgression(KtExpression expression) {
        if (expression instanceof KtParenthesizedExpression) {
            return parseForProgression(((KtParenthesizedExpression) expression).getExpression());
        }
        if (expression instanceof KtDotQualifiedExpression) {
            KtDotQualifiedExpression qualified = (KtDotQualifiedExpression) expression;
            KtExpression selector = qualified.getSelectorExpression();
            if (selector != null && "indices".equals(selector.getText())) {
                return new ForProgression(qualified.getReceiverExpression(), null);
            }
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
            if (base.indicesReceiver != null) {
                return new ForProgression(base.indicesReceiver, binary.getRight());
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

    private enum PrimitiveArrayShape {
        INT("IntArray", ValueType.INT, ValueType.INT_ARRAY, ValueType.INT_2D_ARRAY,
                Opcodes.T_INT, Opcodes.IALOAD, Opcodes.IASTORE, true),
        LONG("LongArray", ValueType.LONG, ValueType.LONG_ARRAY, ValueType.LONG_2D_ARRAY,
                Opcodes.T_LONG, Opcodes.LALOAD, Opcodes.LASTORE, true),
        DOUBLE("DoubleArray", ValueType.DOUBLE, ValueType.DOUBLE_ARRAY, ValueType.DOUBLE_2D_ARRAY,
                Opcodes.T_DOUBLE, Opcodes.DALOAD, Opcodes.DASTORE, true),
        CHAR("CharArray", ValueType.CHAR, ValueType.CHAR_ARRAY, ValueType.CHAR_2D_ARRAY,
                Opcodes.T_CHAR, Opcodes.CALOAD, Opcodes.CASTORE, true),
        BOOLEAN("BooleanArray", ValueType.BOOLEAN, ValueType.BOOLEAN_ARRAY, ValueType.BOOLEAN_2D_ARRAY,
                Opcodes.T_BOOLEAN, Opcodes.BALOAD, Opcodes.BASTORE, false);

        private final String kotlinType;
        private final ValueType elementType;
        private final ValueType arrayType;
        private final ValueType arrayArrayType;
        private final int newArrayOperand;
        private final int loadOpcode;
        private final int storeOpcode;
        private final boolean sortable;

        PrimitiveArrayShape(
                String kotlinType,
                ValueType elementType,
                ValueType arrayType,
                ValueType arrayArrayType,
                int newArrayOperand,
                int loadOpcode,
                int storeOpcode,
                boolean sortable) {
            this.kotlinType = kotlinType;
            this.elementType = elementType;
            this.arrayType = arrayType;
            this.arrayArrayType = arrayArrayType;
            this.newArrayOperand = newArrayOperand;
            this.loadOpcode = loadOpcode;
            this.storeOpcode = storeOpcode;
            this.sortable = sortable;
        }
    }

    private enum ScalarCollectionShape {
        INT("Int", ValueType.INT, ValueType.INT_ARRAY_LIST, ValueType.INT_PRIORITY_QUEUE,
                ValueType.INT_ARRAY_DEQUE, ValueType.INT_HASH_SET),
        LONG("Long", ValueType.LONG, ValueType.LONG_ARRAY_LIST, ValueType.LONG_PRIORITY_QUEUE,
                ValueType.LONG_ARRAY_DEQUE, ValueType.LONG_HASH_SET),
        STRING("String", ValueType.STRING, ValueType.STRING_ARRAY_LIST, null, null, ValueType.STRING_HASH_SET);

        private final String kotlinType;
        private final ValueType elementType;
        private final ValueType arrayListType;
        private final ValueType priorityQueueType;
        private final ValueType arrayDequeType;
        private final ValueType hashSetType;

        ScalarCollectionShape(
                String kotlinType,
                ValueType elementType,
                ValueType arrayListType,
                ValueType priorityQueueType,
                ValueType arrayDequeType,
                ValueType hashSetType) {
            this.kotlinType = kotlinType;
            this.elementType = elementType;
            this.arrayListType = arrayListType;
            this.priorityQueueType = priorityQueueType;
            this.arrayDequeType = arrayDequeType;
            this.hashSetType = hashSetType;
        }
    }

    private enum PairShape {
        INT_INT("Pair<Int,Int>", ValueType.INT, ValueType.INT, ValueType.INT_PAIR,
                ValueType.INT_PAIR_ARRAY_LIST, ValueType.INT_PAIR_ARRAY_LIST_ARRAY,
                ValueType.INT_PAIR_ARRAY_DEQUE, ValueType.INT_PAIR_PRIORITY_QUEUE,
                ValueType.INT_PAIR_SECOND_PRIORITY_QUEUE),
        INT_LONG("Pair<Int,Long>", ValueType.INT, ValueType.LONG, ValueType.INT_LONG_PAIR,
                ValueType.INT_LONG_PAIR_ARRAY_LIST, ValueType.INT_LONG_PAIR_ARRAY_LIST_ARRAY,
                ValueType.INT_LONG_PAIR_ARRAY_DEQUE, null, null),
        LONG_INT("Pair<Long,Int>", ValueType.LONG, ValueType.INT, ValueType.LONG_INT_PAIR,
                ValueType.LONG_INT_PAIR_ARRAY_LIST, ValueType.LONG_INT_PAIR_ARRAY_LIST_ARRAY,
                ValueType.LONG_INT_PAIR_ARRAY_DEQUE, ValueType.LONG_INT_PAIR_PRIORITY_QUEUE, null),
        LONG_LONG("Pair<Long,Long>", ValueType.LONG, ValueType.LONG, ValueType.LONG_LONG_PAIR,
                ValueType.LONG_LONG_PAIR_ARRAY_LIST, ValueType.LONG_LONG_PAIR_ARRAY_LIST_ARRAY,
                ValueType.LONG_LONG_PAIR_ARRAY_DEQUE, null, null);

        private final String kotlinType;
        private final ValueType firstType;
        private final ValueType secondType;
        private final ValueType pairType;
        private final ValueType arrayListType;
        private final ValueType arrayListArrayType;
        private final ValueType arrayDequeType;
        private final ValueType priorityQueueType;
        private final ValueType secondPriorityQueueType;

        PairShape(
                String kotlinType,
                ValueType firstType,
                ValueType secondType,
                ValueType pairType,
                ValueType arrayListType,
                ValueType arrayListArrayType,
                ValueType arrayDequeType,
                ValueType priorityQueueType,
                ValueType secondPriorityQueueType) {
            this.kotlinType = kotlinType;
            this.firstType = firstType;
            this.secondType = secondType;
            this.pairType = pairType;
            this.arrayListType = arrayListType;
            this.arrayListArrayType = arrayListArrayType;
            this.arrayDequeType = arrayDequeType;
            this.priorityQueueType = priorityQueueType;
            this.secondPriorityQueueType = secondPriorityQueueType;
        }
    }

    private enum MapShape {
        INT_INT("Int,Int", ValueType.INT, ValueType.INT, ValueType.INT_INT_HASH_MAP),
        INT_LONG("Int,Long", ValueType.INT, ValueType.LONG, ValueType.INT_LONG_HASH_MAP),
        LONG_INT("Long,Int", ValueType.LONG, ValueType.INT, ValueType.LONG_INT_HASH_MAP),
        LONG_LONG("Long,Long", ValueType.LONG, ValueType.LONG, ValueType.LONG_LONG_HASH_MAP),
        STRING_INT("String,Int", ValueType.STRING, ValueType.INT, ValueType.STRING_INT_HASH_MAP),
        STRING_LONG("String,Long", ValueType.STRING, ValueType.LONG, ValueType.STRING_LONG_HASH_MAP);

        private final String kotlinType;
        private final ValueType keyType;
        private final ValueType valueType;
        private final ValueType mapType;

        MapShape(String kotlinType, ValueType keyType, ValueType valueType, ValueType mapType) {
            this.kotlinType = kotlinType;
            this.keyType = keyType;
            this.valueType = valueType;
            this.mapType = mapType;
        }
    }

    private enum ValueType {
        INT("I", 1, true, false),
        LONG("J", 2, true, false),
        DOUBLE("D", 2, true, false),
        CHAR("C", 1, false, false),
        BOOLEAN("Z", 1, false, false),
        STRING("Ljava/lang/String;", 1, false, false),
        STRING_BUILDER("Ljava/lang/StringBuilder;", 1, false, false),
        INT_ARRAY_LIST("Ljava/util/ArrayList;", 1, false, false),
        LONG_ARRAY_LIST("Ljava/util/ArrayList;", 1, false, false),
        STRING_ARRAY_LIST("Ljava/util/ArrayList;", 1, false, false),
        INT_PAIR_ARRAY_LIST("Ljava/util/ArrayList;", 1, false, false),
        INT_LONG_PAIR_ARRAY_LIST("Ljava/util/ArrayList;", 1, false, false),
        LONG_INT_PAIR_ARRAY_LIST("Ljava/util/ArrayList;", 1, false, false),
        LONG_LONG_PAIR_ARRAY_LIST("Ljava/util/ArrayList;", 1, false, false),
        INT_PRIORITY_QUEUE("Ljava/util/PriorityQueue;", 1, false, false),
        LONG_PRIORITY_QUEUE("Ljava/util/PriorityQueue;", 1, false, false),
        INT_PAIR_PRIORITY_QUEUE("Ljava/util/PriorityQueue;", 1, false, false),
        INT_PAIR_SECOND_PRIORITY_QUEUE("Ljava/util/PriorityQueue;", 1, false, false),
        LONG_INT_PAIR_PRIORITY_QUEUE("Ljava/util/PriorityQueue;", 1, false, false),
        INT_ARRAY_DEQUE("Ljava/util/ArrayDeque;", 1, false, false),
        LONG_ARRAY_DEQUE("Ljava/util/ArrayDeque;", 1, false, false),
        INT_PAIR_ARRAY_DEQUE("Ljava/util/ArrayDeque;", 1, false, false),
        INT_LONG_PAIR_ARRAY_DEQUE("Ljava/util/ArrayDeque;", 1, false, false),
        LONG_INT_PAIR_ARRAY_DEQUE("Ljava/util/ArrayDeque;", 1, false, false),
        LONG_LONG_PAIR_ARRAY_DEQUE("Ljava/util/ArrayDeque;", 1, false, false),
        INT_HASH_SET("Ljava/util/HashSet;", 1, false, false),
        LONG_HASH_SET("Ljava/util/HashSet;", 1, false, false),
        STRING_HASH_SET("Ljava/util/HashSet;", 1, false, false),
        INT_INT_HASH_MAP("Ljava/util/HashMap;", 1, false, false),
        INT_LONG_HASH_MAP("Ljava/util/HashMap;", 1, false, false),
        LONG_INT_HASH_MAP("Ljava/util/HashMap;", 1, false, false),
        LONG_LONG_HASH_MAP("Ljava/util/HashMap;", 1, false, false),
        STRING_INT_HASH_MAP("Ljava/util/HashMap;", 1, false, false),
        STRING_LONG_HASH_MAP("Ljava/util/HashMap;", 1, false, false),
        INT_PAIR("Ljava/util/AbstractMap$SimpleEntry;", 1, false, false),
        INT_LONG_PAIR("Ljava/util/AbstractMap$SimpleEntry;", 1, false, false),
        LONG_INT_PAIR("Ljava/util/AbstractMap$SimpleEntry;", 1, false, false),
        LONG_LONG_PAIR("Ljava/util/AbstractMap$SimpleEntry;", 1, false, false),
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
        INT_ARRAY_LIST_ARRAY("[Ljava/util/ArrayList;", 1, false, true),
        INT_PAIR_ARRAY_LIST_ARRAY("[Ljava/util/ArrayList;", 1, false, true),
        INT_LONG_PAIR_ARRAY_LIST_ARRAY("[Ljava/util/ArrayList;", 1, false, true),
        LONG_INT_PAIR_ARRAY_LIST_ARRAY("[Ljava/util/ArrayList;", 1, false, true),
        LONG_LONG_PAIR_ARRAY_LIST_ARRAY("[Ljava/util/ArrayList;", 1, false, true),
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
        private final KtExpression indicesReceiver;

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
            this.indicesReceiver = null;
        }

        private ForProgression(KtExpression indicesReceiver, KtExpression step) {
            if (indicesReceiver == null) {
                throw new IllegalArgumentException("For-loop indices range is missing a receiver");
            }
            this.start = null;
            this.end = null;
            this.inclusive = false;
            this.descending = false;
            this.step = step;
            this.indicesReceiver = indicesReceiver;
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
