package org.wasmidle.kotlin.teavm;

import com.intellij.lang.ASTNode;
import java.lang.reflect.Constructor;

public final class SimpleReflection {
    private SimpleReflection() {
    }

    public static Object createInstance(Constructor<?> constructor, Object[] arguments) {
        Object direct = createKotlinPsi(constructor, arguments);
        if (direct != null) {
            return direct;
        }
        try {
            return constructor.newInstance(arguments);
        } catch (Throwable failure) {
            throw new RuntimeException("constructor=" + describe(constructor)
                    + " args=" + (arguments == null ? -1 : arguments.length), failure);
        }
    }

    private static Object createKotlinPsi(Constructor<?> constructor, Object[] arguments) {
        if (constructor == null || arguments == null || arguments.length != 1 || !(arguments[0] instanceof ASTNode)) {
            return null;
        }
        ASTNode node = (ASTNode) arguments[0];
        String className;
        try {
            className = constructor.getDeclaringClass().getName();
        } catch (Throwable ignored) {
            return null;
        }
        switch (className) {
            case "org.jetbrains.kotlin.psi.KtAnnotatedExpression":
                return new org.jetbrains.kotlin.psi.KtAnnotatedExpression(node);
            case "org.jetbrains.kotlin.psi.KtAnnotation":
                return new org.jetbrains.kotlin.psi.KtAnnotation(node);
            case "org.jetbrains.kotlin.psi.KtAnnotationEntry":
                return new org.jetbrains.kotlin.psi.KtAnnotationEntry(node);
            case "org.jetbrains.kotlin.psi.KtAnnotationUseSiteTarget":
                return new org.jetbrains.kotlin.psi.KtAnnotationUseSiteTarget(node);
            case "org.jetbrains.kotlin.psi.KtArrayAccessExpression":
                return new org.jetbrains.kotlin.psi.KtArrayAccessExpression(node);
            case "org.jetbrains.kotlin.psi.KtBackingField":
                return new org.jetbrains.kotlin.psi.KtBackingField(node);
            case "org.jetbrains.kotlin.psi.KtBinaryExpression":
                return new org.jetbrains.kotlin.psi.KtBinaryExpression(node);
            case "org.jetbrains.kotlin.psi.KtBinaryExpressionWithTypeRHS":
                return new org.jetbrains.kotlin.psi.KtBinaryExpressionWithTypeRHS(node);
            case "org.jetbrains.kotlin.psi.KtBlockStringTemplateEntry":
                return new org.jetbrains.kotlin.psi.KtBlockStringTemplateEntry(node);
            case "org.jetbrains.kotlin.psi.KtBreakExpression":
                return new org.jetbrains.kotlin.psi.KtBreakExpression(node);
            case "org.jetbrains.kotlin.psi.KtCallExpression":
                return new org.jetbrains.kotlin.psi.KtCallExpression(node);
            case "org.jetbrains.kotlin.psi.KtCallableReferenceExpression":
                return new org.jetbrains.kotlin.psi.KtCallableReferenceExpression(node);
            case "org.jetbrains.kotlin.psi.KtCatchClause":
                return new org.jetbrains.kotlin.psi.KtCatchClause(node);
            case "org.jetbrains.kotlin.psi.KtClass":
                return new org.jetbrains.kotlin.psi.KtClass(node);
            case "org.jetbrains.kotlin.psi.KtClassBody":
                return new org.jetbrains.kotlin.psi.KtClassBody(node);
            case "org.jetbrains.kotlin.psi.KtClassInitializer":
                return new org.jetbrains.kotlin.psi.KtClassInitializer(node);
            case "org.jetbrains.kotlin.psi.KtClassLiteralExpression":
                return new org.jetbrains.kotlin.psi.KtClassLiteralExpression(node);
            case "org.jetbrains.kotlin.psi.KtCollectionLiteralExpression":
                return new org.jetbrains.kotlin.psi.KtCollectionLiteralExpression(node);
            case "org.jetbrains.kotlin.psi.KtConstantExpression":
                return new org.jetbrains.kotlin.psi.KtConstantExpression(node);
            case "org.jetbrains.kotlin.psi.KtConstructorCalleeExpression":
                return new org.jetbrains.kotlin.psi.KtConstructorCalleeExpression(node);
            case "org.jetbrains.kotlin.psi.KtConstructorDelegationCall":
                return new org.jetbrains.kotlin.psi.KtConstructorDelegationCall(node);
            case "org.jetbrains.kotlin.psi.KtConstructorDelegationReferenceExpression":
                return new org.jetbrains.kotlin.psi.KtConstructorDelegationReferenceExpression(node);
            case "org.jetbrains.kotlin.psi.KtContainerNode":
                return new org.jetbrains.kotlin.psi.KtContainerNode(node);
            case "org.jetbrains.kotlin.psi.KtContainerNodeForControlStructureBody":
                return new org.jetbrains.kotlin.psi.KtContainerNodeForControlStructureBody(node);
            case "org.jetbrains.kotlin.psi.KtContextReceiver":
                return new org.jetbrains.kotlin.psi.KtContextReceiver(node);
            case "org.jetbrains.kotlin.psi.KtContextReceiverList":
                return new org.jetbrains.kotlin.psi.KtContextReceiverList(node);
            case "org.jetbrains.kotlin.psi.KtContinueExpression":
                return new org.jetbrains.kotlin.psi.KtContinueExpression(node);
            case "org.jetbrains.kotlin.psi.KtContractEffect":
                return new org.jetbrains.kotlin.psi.KtContractEffect(node);
            case "org.jetbrains.kotlin.psi.KtContractEffectList":
                return new org.jetbrains.kotlin.psi.KtContractEffectList(node);
            case "org.jetbrains.kotlin.psi.KtDeclarationModifierList":
                return new org.jetbrains.kotlin.psi.KtDeclarationModifierList(node);
            case "org.jetbrains.kotlin.psi.KtDelegatedSuperTypeEntry":
                return new org.jetbrains.kotlin.psi.KtDelegatedSuperTypeEntry(node);
            case "org.jetbrains.kotlin.psi.KtDestructuringDeclaration":
                return new org.jetbrains.kotlin.psi.KtDestructuringDeclaration(node);
            case "org.jetbrains.kotlin.psi.KtDestructuringDeclarationEntry":
                return new org.jetbrains.kotlin.psi.KtDestructuringDeclarationEntry(node);
            case "org.jetbrains.kotlin.psi.KtDoWhileExpression":
                return new org.jetbrains.kotlin.psi.KtDoWhileExpression(node);
            case "org.jetbrains.kotlin.psi.KtDotQualifiedExpression":
                return new org.jetbrains.kotlin.psi.KtDotQualifiedExpression(node);
            case "org.jetbrains.kotlin.psi.KtDynamicType":
                return new org.jetbrains.kotlin.psi.KtDynamicType(node);
            case "org.jetbrains.kotlin.psi.KtElementImpl":
                return new org.jetbrains.kotlin.psi.KtElementImpl(node);
            case "org.jetbrains.kotlin.psi.KtElementImplStub":
                return new org.jetbrains.kotlin.psi.KtElementImplStub<>(node);
            case "org.jetbrains.kotlin.psi.KtEnumEntry":
                return new org.jetbrains.kotlin.psi.KtEnumEntry(node);
            case "org.jetbrains.kotlin.psi.KtEnumEntrySuperclassReferenceExpression":
                return new org.jetbrains.kotlin.psi.KtEnumEntrySuperclassReferenceExpression(node);
            case "org.jetbrains.kotlin.psi.KtEscapeStringTemplateEntry":
                return new org.jetbrains.kotlin.psi.KtEscapeStringTemplateEntry(node);
            case "org.jetbrains.kotlin.psi.KtExpressionWithLabel":
                return new org.jetbrains.kotlin.psi.KtExpressionWithLabel(node);
            case "org.jetbrains.kotlin.psi.KtFileAnnotationList":
                return new org.jetbrains.kotlin.psi.KtFileAnnotationList(node);
            case "org.jetbrains.kotlin.psi.KtFinallySection":
                return new org.jetbrains.kotlin.psi.KtFinallySection(node);
            case "org.jetbrains.kotlin.psi.KtForExpression":
                return new org.jetbrains.kotlin.psi.KtForExpression(node);
            case "org.jetbrains.kotlin.psi.KtFunctionLiteral":
                return new org.jetbrains.kotlin.psi.KtFunctionLiteral(node);
            case "org.jetbrains.kotlin.psi.KtFunctionType":
                return new org.jetbrains.kotlin.psi.KtFunctionType(node);
            case "org.jetbrains.kotlin.psi.KtFunctionTypeReceiver":
                return new org.jetbrains.kotlin.psi.KtFunctionTypeReceiver(node);
            case "org.jetbrains.kotlin.psi.KtIfExpression":
                return new org.jetbrains.kotlin.psi.KtIfExpression(node);
            case "org.jetbrains.kotlin.psi.KtImportAlias":
                return new org.jetbrains.kotlin.psi.KtImportAlias(node);
            case "org.jetbrains.kotlin.psi.KtImportDirective":
                return new org.jetbrains.kotlin.psi.KtImportDirective(node);
            case "org.jetbrains.kotlin.psi.KtImportList":
                return new org.jetbrains.kotlin.psi.KtImportList(node);
            case "org.jetbrains.kotlin.psi.KtInitializerList":
                return new org.jetbrains.kotlin.psi.KtInitializerList(node);
            case "org.jetbrains.kotlin.psi.KtIntersectionType":
                return new org.jetbrains.kotlin.psi.KtIntersectionType(node);
            case "org.jetbrains.kotlin.psi.KtIsExpression":
                return new org.jetbrains.kotlin.psi.KtIsExpression(node);
            case "org.jetbrains.kotlin.psi.KtLabelReferenceExpression":
                return new org.jetbrains.kotlin.psi.KtLabelReferenceExpression(node);
            case "org.jetbrains.kotlin.psi.KtLabeledExpression":
                return new org.jetbrains.kotlin.psi.KtLabeledExpression(node);
            case "org.jetbrains.kotlin.psi.KtLambdaArgument":
                return new org.jetbrains.kotlin.psi.KtLambdaArgument(node);
            case "org.jetbrains.kotlin.psi.KtLiteralStringTemplateEntry":
                return new org.jetbrains.kotlin.psi.KtLiteralStringTemplateEntry(node);
            case "org.jetbrains.kotlin.psi.KtModifierListOwnerStub":
                return new org.jetbrains.kotlin.psi.KtModifierListOwnerStub<>(node);
            case "org.jetbrains.kotlin.psi.KtNameReferenceExpression":
                return new org.jetbrains.kotlin.psi.KtNameReferenceExpression(node);
            case "org.jetbrains.kotlin.psi.KtNamedFunction":
                return new org.jetbrains.kotlin.psi.KtNamedFunction(node);
            case "org.jetbrains.kotlin.psi.KtNullableType":
                return new org.jetbrains.kotlin.psi.KtNullableType(node);
            case "org.jetbrains.kotlin.psi.KtObjectDeclaration":
                return new org.jetbrains.kotlin.psi.KtObjectDeclaration(node);
            case "org.jetbrains.kotlin.psi.KtObjectLiteralExpression":
                return new org.jetbrains.kotlin.psi.KtObjectLiteralExpression(node);
            case "org.jetbrains.kotlin.psi.KtOperationReferenceExpression":
                return new org.jetbrains.kotlin.psi.KtOperationReferenceExpression(node);
            case "org.jetbrains.kotlin.psi.KtPackageDirective":
                return new org.jetbrains.kotlin.psi.KtPackageDirective(node);
            case "org.jetbrains.kotlin.psi.KtParameter":
                return new org.jetbrains.kotlin.psi.KtParameter(node);
            case "org.jetbrains.kotlin.psi.KtParameterList":
                return new org.jetbrains.kotlin.psi.KtParameterList(node);
            case "org.jetbrains.kotlin.psi.KtParenthesizedExpression":
                return new org.jetbrains.kotlin.psi.KtParenthesizedExpression(node);
            case "org.jetbrains.kotlin.psi.KtPostfixExpression":
                return new org.jetbrains.kotlin.psi.KtPostfixExpression(node);
            case "org.jetbrains.kotlin.psi.KtPrefixExpression":
                return new org.jetbrains.kotlin.psi.KtPrefixExpression(node);
            case "org.jetbrains.kotlin.psi.KtPrimaryConstructor":
                return new org.jetbrains.kotlin.psi.KtPrimaryConstructor(node);
            case "org.jetbrains.kotlin.psi.KtProperty":
                return new org.jetbrains.kotlin.psi.KtProperty(node);
            case "org.jetbrains.kotlin.psi.KtPropertyAccessor":
                return new org.jetbrains.kotlin.psi.KtPropertyAccessor(node);
            case "org.jetbrains.kotlin.psi.KtPropertyDelegate":
                return new org.jetbrains.kotlin.psi.KtPropertyDelegate(node);
            case "org.jetbrains.kotlin.psi.KtReturnExpression":
                return new org.jetbrains.kotlin.psi.KtReturnExpression(node);
            case "org.jetbrains.kotlin.psi.KtSafeQualifiedExpression":
                return new org.jetbrains.kotlin.psi.KtSafeQualifiedExpression(node);
            case "org.jetbrains.kotlin.psi.KtScript":
                return new org.jetbrains.kotlin.psi.KtScript(node);
            case "org.jetbrains.kotlin.psi.KtScriptInitializer":
                return new org.jetbrains.kotlin.psi.KtScriptInitializer(node);
            case "org.jetbrains.kotlin.psi.KtSecondaryConstructor":
                return new org.jetbrains.kotlin.psi.KtSecondaryConstructor(node);
            case "org.jetbrains.kotlin.psi.KtSelfType":
                return new org.jetbrains.kotlin.psi.KtSelfType(node);
            case "org.jetbrains.kotlin.psi.KtSimpleNameStringTemplateEntry":
                return new org.jetbrains.kotlin.psi.KtSimpleNameStringTemplateEntry(node);
            case "org.jetbrains.kotlin.psi.KtStringTemplateExpression":
                return new org.jetbrains.kotlin.psi.KtStringTemplateExpression(node);
            case "org.jetbrains.kotlin.psi.KtSuperExpression":
                return new org.jetbrains.kotlin.psi.KtSuperExpression(node);
            case "org.jetbrains.kotlin.psi.KtSuperTypeCallEntry":
                return new org.jetbrains.kotlin.psi.KtSuperTypeCallEntry(node);
            case "org.jetbrains.kotlin.psi.KtSuperTypeEntry":
                return new org.jetbrains.kotlin.psi.KtSuperTypeEntry(node);
            case "org.jetbrains.kotlin.psi.KtSuperTypeList":
                return new org.jetbrains.kotlin.psi.KtSuperTypeList(node);
            case "org.jetbrains.kotlin.psi.KtSuperTypeListEntry":
                return new org.jetbrains.kotlin.psi.KtSuperTypeListEntry(node);
            case "org.jetbrains.kotlin.psi.KtThisExpression":
                return new org.jetbrains.kotlin.psi.KtThisExpression(node);
            case "org.jetbrains.kotlin.psi.KtThrowExpression":
                return new org.jetbrains.kotlin.psi.KtThrowExpression(node);
            case "org.jetbrains.kotlin.psi.KtTryExpression":
                return new org.jetbrains.kotlin.psi.KtTryExpression(node);
            case "org.jetbrains.kotlin.psi.KtTypeAlias":
                return new org.jetbrains.kotlin.psi.KtTypeAlias(node);
            case "org.jetbrains.kotlin.psi.KtTypeArgumentList":
                return new org.jetbrains.kotlin.psi.KtTypeArgumentList(node);
            case "org.jetbrains.kotlin.psi.KtTypeConstraint":
                return new org.jetbrains.kotlin.psi.KtTypeConstraint(node);
            case "org.jetbrains.kotlin.psi.KtTypeConstraintList":
                return new org.jetbrains.kotlin.psi.KtTypeConstraintList(node);
            case "org.jetbrains.kotlin.psi.KtTypeParameter":
                return new org.jetbrains.kotlin.psi.KtTypeParameter(node);
            case "org.jetbrains.kotlin.psi.KtTypeParameterList":
                return new org.jetbrains.kotlin.psi.KtTypeParameterList(node);
            case "org.jetbrains.kotlin.psi.KtTypeProjection":
                return new org.jetbrains.kotlin.psi.KtTypeProjection(node);
            case "org.jetbrains.kotlin.psi.KtTypeReference":
                return new org.jetbrains.kotlin.psi.KtTypeReference(node);
            case "org.jetbrains.kotlin.psi.KtUserType":
                return new org.jetbrains.kotlin.psi.KtUserType(node);
            case "org.jetbrains.kotlin.psi.KtValueArgument":
                return new org.jetbrains.kotlin.psi.KtValueArgument(node);
            case "org.jetbrains.kotlin.psi.KtValueArgumentList":
                return new org.jetbrains.kotlin.psi.KtValueArgumentList(node);
            case "org.jetbrains.kotlin.psi.KtValueArgumentName":
                return new org.jetbrains.kotlin.psi.KtValueArgumentName(node);
            case "org.jetbrains.kotlin.psi.KtWhenConditionInRange":
                return new org.jetbrains.kotlin.psi.KtWhenConditionInRange(node);
            case "org.jetbrains.kotlin.psi.KtWhenConditionIsPattern":
                return new org.jetbrains.kotlin.psi.KtWhenConditionIsPattern(node);
            case "org.jetbrains.kotlin.psi.KtWhenConditionWithExpression":
                return new org.jetbrains.kotlin.psi.KtWhenConditionWithExpression(node);
            case "org.jetbrains.kotlin.psi.KtWhenEntry":
                return new org.jetbrains.kotlin.psi.KtWhenEntry(node);
            case "org.jetbrains.kotlin.psi.KtWhenExpression":
                return new org.jetbrains.kotlin.psi.KtWhenExpression(node);
            case "org.jetbrains.kotlin.psi.KtWhileExpression":
                return new org.jetbrains.kotlin.psi.KtWhileExpression(node);
            default:
                return null;
        }
    }

    private static String describe(Constructor<?> constructor) {
        if (constructor == null) {
            return "<null>";
        }
        try {
            Class<?> declaringClass = constructor.getDeclaringClass();
            return declaringClass == null ? constructor.toString() : declaringClass.getName();
        } catch (Throwable ignored) {
            try {
                return constructor.toString();
            } catch (Throwable nested) {
                return "<unavailable>";
            }
        }
    }
}
