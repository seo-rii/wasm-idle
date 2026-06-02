package org.teavm.classlib.javax.swing;

import org.teavm.classlib.java.awt.TComponent;
import org.teavm.classlib.java.awt.TGraphics;

public interface TIcon {
    void paintIcon(TComponent component, TGraphics graphics, int x, int y);

    int getIconWidth();

    int getIconHeight();
}
