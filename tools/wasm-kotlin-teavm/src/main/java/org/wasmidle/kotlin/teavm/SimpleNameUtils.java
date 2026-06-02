package org.wasmidle.kotlin.teavm;

public final class SimpleNameUtils {
    private SimpleNameUtils() {
    }

    public static String sanitizeAsJavaIdentifier(String name) {
        if (name == null || name.isEmpty()) {
            return "_";
        }
        var result = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            char ch = name.charAt(i);
            result.append(isAsciiLetter(ch) || isAsciiDigit(ch) ? ch : '_');
        }
        return result.toString();
    }

    public static String getPackagePartClassNamePrefix(String shortFileName) {
        String sanitized = sanitizeAsJavaIdentifier(shortFileName);
        if (sanitized.isEmpty()) {
            return "_";
        }
        char first = sanitized.charAt(0);
        if (isAsciiLetter(first) || first == '_') {
            if ('a' <= first && first <= 'z') {
                return Character.toString((char) (first - ('a' - 'A'))) + sanitized.substring(1);
            }
            return sanitized;
        }
        return "_" + sanitized;
    }

    private static boolean isAsciiLetter(char ch) {
        return ('a' <= ch && ch <= 'z') || ('A' <= ch && ch <= 'Z');
    }

    private static boolean isAsciiDigit(char ch) {
        return '0' <= ch && ch <= '9';
    }
}
