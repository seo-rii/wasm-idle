package org.wasmidle.kotlin.teavm;

import com.intellij.lang.ASTNode;
import java.lang.reflect.Constructor;
import org.jetbrains.kotlin.psi.KtElement;
import org.jetbrains.kotlin.psi.KtElementImpl;

public final class SimplePsiFactories {
    private SimplePsiFactories() {
    }

    public static KtElement create(Constructor<? extends KtElement> factory, ASTNode node) {
        if (factory == null) {
            return new KtElementImpl(node);
        }
        KtElement direct = createDirect(factory.getDeclaringClass().getName(), node);
        if (direct != null) {
            return direct;
        }
        try {
            factory.setAccessible(true);
            return factory.newInstance(node);
        } catch (Exception failure) {
            throw new RuntimeException("Error creating psi element for "
                    + factory.getDeclaringClass().getName(), failure);
        }
    }

    private static KtElement createDirect(String className, ASTNode node) {
        if ("org.jetbrains.kotlin.psi.KtBinaryExpression".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtBinaryExpression(node);
        }
        if ("org.jetbrains.kotlin.psi.KtCallExpression".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtCallExpression(node);
        }
        if ("org.jetbrains.kotlin.psi.KtConstantExpression".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtConstantExpression(node);
        }
        if ("org.jetbrains.kotlin.psi.KtContainerNode".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtContainerNode(node);
        }
        if ("org.jetbrains.kotlin.psi.KtNameReferenceExpression".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtNameReferenceExpression(node);
        }
        if ("org.jetbrains.kotlin.psi.KtNamedFunction".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtNamedFunction(node);
        }
        if ("org.jetbrains.kotlin.psi.KtOperationReferenceExpression".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtOperationReferenceExpression(node);
        }
        if ("org.jetbrains.kotlin.psi.KtParenthesizedExpression".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtParenthesizedExpression(node);
        }
        if ("org.jetbrains.kotlin.psi.KtProperty".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtProperty(node);
        }
        if ("org.jetbrains.kotlin.psi.KtStringTemplateExpression".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtStringTemplateExpression(node);
        }
        if ("org.jetbrains.kotlin.psi.KtValueArgument".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtValueArgument(node);
        }
        if ("org.jetbrains.kotlin.psi.KtValueArgumentList".equals(className)) {
            return new org.jetbrains.kotlin.psi.KtValueArgumentList(node);
        }
        return null;
    }
}
