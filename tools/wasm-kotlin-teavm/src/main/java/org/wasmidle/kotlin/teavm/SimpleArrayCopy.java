package org.wasmidle.kotlin.teavm;

public final class SimpleArrayCopy {
    private SimpleArrayCopy() {
    }

    public static void copy(Object source, int sourcePosition, Object target, int targetPosition, int length) {
        if (length <= 0) {
            return;
        }
        if (source instanceof Object[] && target instanceof Object[]) {
            Object[] sourceArray = (Object[]) source;
            Object[] targetArray = (Object[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        if (source instanceof int[] && target instanceof int[]) {
            int[] sourceArray = (int[]) source;
            int[] targetArray = (int[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        if (source instanceof byte[] && target instanceof byte[]) {
            byte[] sourceArray = (byte[]) source;
            byte[] targetArray = (byte[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        if (source instanceof char[] && target instanceof char[]) {
            char[] sourceArray = (char[]) source;
            char[] targetArray = (char[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        if (source instanceof long[] && target instanceof long[]) {
            long[] sourceArray = (long[]) source;
            long[] targetArray = (long[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        if (source instanceof boolean[] && target instanceof boolean[]) {
            boolean[] sourceArray = (boolean[]) source;
            boolean[] targetArray = (boolean[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        if (source instanceof short[] && target instanceof short[]) {
            short[] sourceArray = (short[]) source;
            short[] targetArray = (short[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        if (source instanceof float[] && target instanceof float[]) {
            float[] sourceArray = (float[]) source;
            float[] targetArray = (float[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        if (source instanceof double[] && target instanceof double[]) {
            double[] sourceArray = (double[]) source;
            double[] targetArray = (double[]) target;
            if (source == target && targetPosition > sourcePosition) {
                for (int i = length - 1; i >= 0; i--) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            } else {
                for (int i = 0; i < length; i++) {
                    targetArray[targetPosition + i] = sourceArray[sourcePosition + i];
                }
            }
            return;
        }
        throw new ArrayStoreException("Unsupported arraycopy types");
    }
}
