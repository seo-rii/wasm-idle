package org.wasmidle.kotlin.teavm;

import org.jetbrains.kotlin.cli.common.ExitCode;
import org.jetbrains.kotlin.cli.jvm.K2JVMCompiler;

public final class KotlinCompilerProbe {
    private KotlinCompilerProbe() {
    }

    public static void main(String[] args) {
        ExitCode exitCode = new K2JVMCompiler().exec(System.err, args);
        System.out.println("KOTLIN_EXIT_CODE=" + exitCode.getCode());
    }
}
