package org.teavm.classlib.java.beans;

import org.teavm.classlib.java.io.TSerializable;

public class TPropertyChangeSupport implements TSerializable {
    public TPropertyChangeSupport(Object sourceBean) {
    }

    public void addPropertyChangeListener(TPropertyChangeListener listener) {
    }

    public void removePropertyChangeListener(TPropertyChangeListener listener) {
    }

    public TPropertyChangeListener[] getPropertyChangeListeners() {
        return new TPropertyChangeListener[0];
    }

    public void addPropertyChangeListener(String propertyName, TPropertyChangeListener listener) {
    }

    public void removePropertyChangeListener(String propertyName, TPropertyChangeListener listener) {
    }

    public TPropertyChangeListener[] getPropertyChangeListeners(String propertyName) {
        return new TPropertyChangeListener[0];
    }

    public void firePropertyChange(String propertyName, Object oldValue, Object newValue) {
    }

    public void firePropertyChange(String propertyName, int oldValue, int newValue) {
    }

    public void firePropertyChange(String propertyName, boolean oldValue, boolean newValue) {
    }

    public void firePropertyChange(TPropertyChangeEvent event) {
    }

    public void fireIndexedPropertyChange(String propertyName, int index, Object oldValue, Object newValue) {
    }

    public void fireIndexedPropertyChange(String propertyName, int index, int oldValue, int newValue) {
    }

    public void fireIndexedPropertyChange(String propertyName, int index, boolean oldValue, boolean newValue) {
    }

    public boolean hasListeners(String propertyName) {
        return false;
    }
}
