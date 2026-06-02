package org.wasmidle.kotlin.teavm;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.jetbrains.kotlin.psi.KtFile;

public final class SimpleSourceRegistry {
    private static final List<KtFile> files = new ArrayList<>();

    private SimpleSourceRegistry() {
    }

    public static synchronized void clear() {
        files.clear();
        SimpleKotlinAnalysisBridge.clear();
    }

    public static synchronized void add(KtFile file) {
        if (file == null) {
            return;
        }
        for (KtFile existing : files) {
            if (existing == file) {
                return;
            }
        }
        files.add(file);
    }

    public static synchronized Collection<KtFile> files() {
        return new ArrayList<>(files);
    }
}
