package org.teavm.classlib.java.lang;

public class TTypeNotPresentException extends TRuntimeException {
    private final String typeName;

    public TTypeNotPresentException(String typeName, TThrowable cause) {
        super("Type " + typeName + " not present", cause);
        this.typeName = typeName;
    }

    public String typeName() {
        return typeName;
    }
}
