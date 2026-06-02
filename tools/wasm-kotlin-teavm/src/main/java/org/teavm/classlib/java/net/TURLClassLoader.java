package org.teavm.classlib.java.net;

import java.net.URL;

public class TURLClassLoader extends ClassLoader {
    public TURLClassLoader(URL[] urls) {
    }

    public TURLClassLoader(URL[] urls, ClassLoader parent) {
        super(parent);
    }

    public URL[] getURLs() {
        return new URL[0];
    }

    public void close() {
    }
}
