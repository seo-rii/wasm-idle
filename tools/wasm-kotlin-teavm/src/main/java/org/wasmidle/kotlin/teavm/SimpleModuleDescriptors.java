package org.wasmidle.kotlin.teavm;

import org.jetbrains.kotlin.builtins.DefaultBuiltIns;
import org.jetbrains.kotlin.descriptors.PackageFragmentProvider;
import org.jetbrains.kotlin.descriptors.impl.ModuleDescriptorImpl;
import org.jetbrains.kotlin.name.Name;
import org.jetbrains.kotlin.storage.LockBasedStorageManager;

public final class SimpleModuleDescriptors {
    private SimpleModuleDescriptors() {
    }

    public static ModuleDescriptorImpl create(String name) {
        var module = new ModuleDescriptorImpl(
                Name.special(name),
                LockBasedStorageManager.NO_LOCKS,
                DefaultBuiltIns.getInstance());
        module.setDependencies(module);
        module.initialize(PackageFragmentProvider.Empty.INSTANCE);
        return module;
    }
}
