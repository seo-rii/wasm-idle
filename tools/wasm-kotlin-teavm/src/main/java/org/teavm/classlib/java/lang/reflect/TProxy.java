package org.teavm.classlib.java.lang.reflect;

public class TProxy {
    protected TInvocationHandler h;

    protected TProxy(TInvocationHandler h) {
        this.h = h;
    }

    public static Class<?> getProxyClass(ClassLoader loader, Class<?>... interfaces) {
        return Object.class;
    }

    public static Object newProxyInstance(ClassLoader loader, Class<?>[] interfaces, TInvocationHandler h) {
        return null;
    }

    public static boolean isProxyClass(Class<?> cls) {
        return false;
    }

    public static TInvocationHandler getInvocationHandler(Object proxy) {
        return null;
    }
}
