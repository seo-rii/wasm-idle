/*
 * Copyright 2026 wasm-idle contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */
package org.teavm.classlib.java.util;

public class TIllegalFormatWidthException extends TIllegalFormatException {
    private int width;

    public TIllegalFormatWidthException(int width) {
        super("Illegal width: " + width);
        this.width = width;
    }

    public int getWidth() {
        return width;
    }
}
