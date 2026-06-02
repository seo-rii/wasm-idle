package org.teavm.classlib.java.util;

public final class TStringJoiner {
    private final String delimiter;
    private final String prefix;
    private final String suffix;
    private String emptyValue;
    private StringBuilder builder;

    public TStringJoiner(CharSequence delimiter) {
        this(delimiter, "", "");
    }

    public TStringJoiner(CharSequence delimiter, CharSequence prefix, CharSequence suffix) {
        if (delimiter == null || prefix == null || suffix == null) {
            throw new NullPointerException();
        }
        this.delimiter = delimiter.toString();
        this.prefix = prefix.toString();
        this.suffix = suffix.toString();
        emptyValue = this.prefix + this.suffix;
    }

    public TStringJoiner setEmptyValue(CharSequence emptyValue) {
        if (emptyValue == null) {
            throw new NullPointerException();
        }
        this.emptyValue = emptyValue.toString();
        return this;
    }

    public TStringJoiner add(CharSequence value) {
        prepareBuilder();
        if (builder.length() > prefix.length()) {
            builder.append(delimiter);
        }
        builder.append(value);
        return this;
    }

    public TStringJoiner merge(TStringJoiner other) {
        if (other.builder != null) {
            var value = other.builder.substring(other.prefix.length());
            if (!value.isEmpty()) {
                add(value);
            }
        }
        return this;
    }

    public int length() {
        return toString().length();
    }

    @Override
    public String toString() {
        if (builder == null) {
            return emptyValue;
        }
        return builder.toString() + suffix;
    }

    private void prepareBuilder() {
        if (builder == null) {
            builder = new StringBuilder(prefix);
        }
    }
}
