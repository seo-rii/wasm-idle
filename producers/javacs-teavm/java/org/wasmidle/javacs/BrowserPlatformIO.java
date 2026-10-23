package org.wasmidle.javacs;

import java.io.*;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;

/** Standard JDK operations missing from the otherwise upstream TeaVM 0.16 NIO classlib. */
public final class BrowserPlatformIO {
    public static Path toPath(File file) { return Path.of(file.getPath()); }
    public static void createDirectories(Path directory) throws IOException {
        // TeaVM 0.16 retries createDirectory for existing one-name roots.
        // Preserve native createDirectories' idempotence and its file errors.
        if (!Files.isDirectory(directory)) Files.createDirectories(directory);
    }
    public static Path pathOf(URI uri) {
        // TeaVM 0.16 Path.of mistakenly asks getFileSystem(uri), whose file provider
        // accepts only file:///. The provider's getPath performs the proper checks.
        return FileSystems.getDefault().provider().getPath(uri);
    }
    public static URI toUri(Path path) {
        // TeaVM 0.16 prefixes the current directory even for an absolute path,
        // producing file://workspace instead of the native file:///workspace.
        var absolute = path.toAbsolutePath().toString();
        if (Files.isDirectory(path) && !absolute.endsWith("/")) absolute += "/";
        try {
            // Reparse the canonical ASCII spelling so an empty authority has
            // exactly the same null representation as a received file:/// URI.
            return URI.create(new URI("file", "", absolute, null, null).toASCIIString());
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("Cannot encode workspace path", e);
        }
    }
    public static long transferTo(Reader reader, Writer writer) throws IOException {
        var chars = new char[8192];
        long total = 0;
        for (int count; (count = reader.read(chars)) >= 0;) {
            writer.write(chars, 0, count);
            total += count;
        }
        return total;
    }
}
