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
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

public final class ApplyRuntimeClasslibOverlay {
    private ApplyRuntimeClasslibOverlay() {
    }

    // An input SHA-256 of "-" appends an entry that the canonical archive must not contain.
    private record Replacement(String inputSha256, byte[] bytes) {
        boolean isAddition() {
            return inputSha256.equals("-");
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 7 || (args.length - 3) % 4 != 0) {
            throw new IllegalArgumentException(
                    "usage: <input> <output> <entry-count> (<entry> <replacement-class> <input-sha256|-> <replacement-sha256>)...");
        }
        Path input = Path.of(args[0]);
        Path output = Path.of(args[1]);
        int expectedEntryCount = Integer.parseInt(args[2]);
        Map<String, Replacement> replacements = new LinkedHashMap<>();
        for (int index = 3; index < args.length; index += 4) {
            String targetEntry = args[index];
            byte[] replacement = Files.readAllBytes(Path.of(args[index + 1]));
            requireDigest(replacement, args[index + 3], "replacement " + targetEntry);
            if (replacements.put(targetEntry, new Replacement(args[index + 2], replacement)) != null) {
                throw new IllegalArgumentException("duplicate TeaVM archive overlay target " + targetEntry);
            }
        }

        Set<String> replaced = new HashSet<>();
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
                Replacement replacement = replacements.get(name);
                if (replacement != null) {
                    if (replacement.isAddition()) {
                        throw new IOException("TeaVM archive already contains added entry " + name);
                    }
                    if (!replaced.add(name)) {
                        throw new IOException("duplicate TeaVM archive entry " + name);
                    }
                    requireDigest(data, replacement.inputSha256(), "canonical " + name);
                    data = replacement.bytes();
                }
                archiveOutput.writeShort(nameBytes.length);
                archiveOutput.write(nameBytes);
                archiveOutput.writeInt(data.length);
                archiveOutput.write(data);
                entries++;
            }
            for (Map.Entry<String, Replacement> addition : replacements.entrySet()) {
                if (addition.getValue().isAddition()) {
                    byte[] nameBytes = addition.getKey().getBytes(StandardCharsets.UTF_8);
                    archiveOutput.writeShort(nameBytes.length);
                    archiveOutput.write(nameBytes);
                    archiveOutput.writeInt(addition.getValue().bytes().length);
                    archiveOutput.write(addition.getValue().bytes());
                }
            }
        }
        Set<String> expectedReplacements = new HashSet<>();
        for (Map.Entry<String, Replacement> replacement : replacements.entrySet()) {
            if (!replacement.getValue().isAddition()) {
                expectedReplacements.add(replacement.getKey());
            }
        }
        if (!replaced.equals(expectedReplacements)) {
            Files.deleteIfExists(output);
            throw new IOException(
                    "expected TeaVM archive overlay targets " + expectedReplacements + ", found " + replaced);
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
