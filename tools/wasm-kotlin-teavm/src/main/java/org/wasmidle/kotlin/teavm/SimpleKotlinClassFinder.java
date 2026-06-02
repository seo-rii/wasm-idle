package org.wasmidle.kotlin.teavm;

import java.io.InputStream;
import java.util.Collections;
import java.util.Set;
import org.jetbrains.kotlin.load.java.structure.JavaClass;
import org.jetbrains.kotlin.load.kotlin.KotlinClassFinder;
import org.jetbrains.kotlin.metadata.jvm.deserialization.JvmMetadataVersion;
import org.jetbrains.kotlin.name.ClassId;
import org.jetbrains.kotlin.name.FqName;

public final class SimpleKotlinClassFinder implements KotlinClassFinder {
    @Override
    public Result findKotlinClassOrContent(ClassId classId, JvmMetadataVersion metadataVersion) {
        return null;
    }

    @Override
    public Result findKotlinClassOrContent(JavaClass javaClass, JvmMetadataVersion metadataVersion) {
        return null;
    }

    @Override
    public InputStream findMetadata(ClassId classId) {
        return null;
    }

    @Override
    public Set<String> findMetadataTopLevelClassesInPackage(FqName packageFqName) {
        return Collections.emptySet();
    }

    @Override
    public boolean hasMetadataPackage(FqName packageFqName) {
        return false;
    }

    @Override
    public InputStream findBuiltInsData(FqName packageFqName) {
        var packagePath = packageFqName.asString().replace('.', '/');
        var fileName = packageFqName.isRoot() ? "default-package" : packageFqName.shortName().asString();
        return KotlinBuiltinsResources.open(packagePath + "/" + fileName + ".kotlin_builtins");
    }
}
