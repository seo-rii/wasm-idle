package org.teavm.classlib.java.security;

public class TMessageDigest {
    protected TMessageDigest(String algorithm) {
    }

    public static TMessageDigest getInstance(String algorithm) throws TNoSuchAlgorithmException {
        return new TMessageDigest(algorithm);
    }

    public void update(byte input) {
    }

    public void update(byte[] input) {
    }

    public void update(byte[] input, int offset, int len) {
    }

    public byte[] digest() {
        return new byte[16];
    }

    public byte[] digest(byte[] input) {
        return new byte[16];
    }

    public int digest(byte[] buf, int offset, int len) {
        var digest = digest();
        var count = Math.min(len, digest.length);
        System.arraycopy(digest, 0, buf, offset, count);
        return count;
    }

    public void reset() {
    }
}
