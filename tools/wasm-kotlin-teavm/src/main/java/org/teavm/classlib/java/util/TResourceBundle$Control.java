package org.teavm.classlib.java.util;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.ResourceBundle;

public class TResourceBundle$Control {
    public static final long TTL_DONT_CACHE = -1L;
    public static final long TTL_NO_EXPIRATION_CONTROL = -2L;

    public static TResourceBundle$Control getControl(List<String> formats) {
        return new TResourceBundle$Control();
    }

    public static TResourceBundle$Control getNoFallbackControl(List<String> formats) {
        return new TResourceBundle$Control();
    }

    public List<String> getFormats(String baseName) {
        return Collections.emptyList();
    }

    public List<Locale> getCandidateLocales(String baseName, Locale locale) {
        return Collections.emptyList();
    }

    public Locale getFallbackLocale(String baseName, Locale locale) {
        return null;
    }

    public ResourceBundle newBundle(String baseName, Locale locale, String format, ClassLoader loader,
            boolean reload) throws IllegalAccessException, InstantiationException, IOException {
        return null;
    }

    public long getTimeToLive(String baseName, Locale locale) {
        return TTL_DONT_CACHE;
    }

    public boolean needsReload(String baseName, Locale locale, String format, ClassLoader loader,
            ResourceBundle bundle, long loadTime) {
        return false;
    }

    public String toBundleName(String baseName, Locale locale) {
        return baseName;
    }

    public String toResourceName(String bundleName, String suffix) {
        return bundleName.replace('.', '/') + "." + suffix;
    }
}
