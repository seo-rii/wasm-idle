package org.wasmidle.kotlin.teavm;

import java.util.Collections;
import org.jetbrains.kotlin.descriptors.CallableMemberDescriptor;
import org.jetbrains.kotlin.descriptors.DeclarationDescriptor;
import org.jetbrains.kotlin.descriptors.DescriptorVisibilities;
import org.jetbrains.kotlin.descriptors.Modality;
import org.jetbrains.kotlin.descriptors.SimpleFunctionDescriptor;
import org.jetbrains.kotlin.descriptors.annotations.Annotations;
import org.jetbrains.kotlin.descriptors.impl.SimpleFunctionDescriptorImpl;
import org.jetbrains.kotlin.psi.KtNamedFunction;
import org.jetbrains.kotlin.resolve.BindingContextUtils;
import org.jetbrains.kotlin.resolve.BindingTrace;
import org.jetbrains.kotlin.resolve.source.KotlinSourceElementKt;
import org.jetbrains.kotlin.types.TypeUtils;

public final class SimpleFunctionDescriptorResolvers {
    private SimpleFunctionDescriptorResolvers() {
    }

    public static SimpleFunctionDescriptor resolveFunctionDescriptor(
            DeclarationDescriptor containingDescriptor,
            KtNamedFunction function,
            BindingTrace trace) {
        var descriptor = SimpleFunctionDescriptorImpl.create(
                containingDescriptor,
                Annotations.Companion.getEMPTY(),
                function.getNameAsSafeName(),
                CallableMemberDescriptor.Kind.DECLARATION,
                KotlinSourceElementKt.toSourceElement(function));
        descriptor.initialize(
                null,
                null,
                Collections.emptyList(),
                Collections.emptyList(),
                TypeUtils.NO_EXPECTED_TYPE,
                Modality.FINAL,
                DescriptorVisibilities.PUBLIC);
        BindingContextUtils.recordFunctionDeclarationToDescriptor(trace, function, descriptor);
        return descriptor;
    }
}
