package org.teavm.classlib.java.beans;

import org.teavm.classlib.java.util.TEventListener;

public interface TPropertyChangeListener extends TEventListener {
    void propertyChange(TPropertyChangeEvent event);
}
