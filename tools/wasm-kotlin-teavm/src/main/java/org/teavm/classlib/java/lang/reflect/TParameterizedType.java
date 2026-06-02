package org.teavm.classlib.java.lang.reflect;

public interface TParameterizedType extends TType {
    TType[] getActualTypeArguments();

    TType getRawType();

    TType getOwnerType();
}
