package org.wasmidle.kotlin.teavm;

import com.intellij.openapi.vfs.VirtualFileSystem;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class BrowserVirtualFileSystems {
    private BrowserVirtualFileSystems() {
    }

    public static List<? extends VirtualFileSystem> forProtocol(
            List<? extends VirtualFileSystem> fileSystems, String protocol) {
        if (fileSystems == null || protocol == null) {
            return Collections.emptyList();
        }

        var matches = new ArrayList<VirtualFileSystem>(1);
        for (var fileSystem : fileSystems) {
            if (fileSystem != null && protocol.equals(fileSystem.getProtocol())) {
                matches.add(fileSystem);
            }
        }
        return matches;
    }
}
