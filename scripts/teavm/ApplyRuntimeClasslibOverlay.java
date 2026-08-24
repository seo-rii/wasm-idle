/*
 * Copyright 2026 wasm-idle contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 */

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

public final class ApplyRuntimeClasslibOverlay {
    private ApplyRuntimeClasslibOverlay() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 7) {
            throw new IllegalArgumentException(
                    "usage: <input> <replacement-class> <output> <entry> <input-sha256> <replacement-sha256> <entry-count>");
        }
        Path input = Path.of(args[0]);
        Path replacementPath = Path.of(args[1]);
        Path output = Path.of(args[2]);
        String targetEntry = args[3];
        String expectedInputSha256 = args[4];
        String expectedReplacementSha256 = args[5];
        int expectedEntryCount = Integer.parseInt(args[6]);
        byte[] replacement = Files.readAllBytes(replacementPath);
        requireDigest(replacement, expectedReplacementSha256, "replacement class");

        int replacements = 0;
        int entries = 0;
        try (InputStream fileInput = Files.newInputStream(input);
                DataInputStream archiveInput = new DataInputStream(new GZIPInputStream(fileInput));
                OutputStream fileOutput = Files.newOutputStream(output);
                DataOutputStream archiveOutput =
                        new DataOutputStream(new GZIPOutputStream(fileOutput))) {
            while (true) {
                int firstNameLengthByte = archiveInput.read();
                if (firstNameLengthByte == -1) {
                    break;
                }
                int secondNameLengthByte = archiveInput.read();
                if (secondNameLengthByte == -1) {
                    throw new EOFException("truncated TeaVM archive entry-name length");
                }
                int nameLength = (firstNameLengthByte << 8) | secondNameLengthByte;
                byte[] nameBytes = readExactly(archiveInput, nameLength, "entry name");
                String name = new String(nameBytes, StandardCharsets.UTF_8);
                int dataLength = archiveInput.readInt();
                if (dataLength < 0) {
                    throw new IOException("negative TeaVM archive entry length for " + name);
                }
                byte[] data = readExactly(archiveInput, dataLength, name);
                if (name.equals(targetEntry)) {
                    requireDigest(data, expectedInputSha256, "canonical " + targetEntry);
                    data = replacement;
                    replacements++;
                }
                archiveOutput.writeShort(nameBytes.length);
                archiveOutput.write(nameBytes);
                archiveOutput.writeInt(data.length);
                archiveOutput.write(data);
                entries++;
            }
        }
        if (replacements != 1) {
            Files.deleteIfExists(output);
            throw new IOException(
                    "expected exactly one TeaVM archive overlay target, found " + replacements);
        }
        if (entries != expectedEntryCount) {
            Files.deleteIfExists(output);
            throw new IOException(
                    "expected " + expectedEntryCount + " TeaVM archive entries, found " + entries);
        }
    }

    private static byte[] readExactly(DataInputStream input, int length, String label)
            throws IOException {
        byte[] value = input.readNBytes(length);
        if (value.length != length) {
            throw new EOFException("truncated TeaVM archive " + label);
        }
        return value;
    }

    private static void requireDigest(byte[] value, String expected, String label)
            throws NoSuchAlgorithmException {
        String actual = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
        if (!actual.equals(expected)) {
            throw new IllegalArgumentException(label + " SHA-256 mismatch: " + actual);
        }
    }
}
