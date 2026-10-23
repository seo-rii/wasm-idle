import java.io.StringReader;
import java.io.StringWriter;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import org.wasmidle.javacs.BrowserPlatformIO;

/** Compare platform hooks with the independent native JDK standard APIs. */
public final class VerifyPlatformIO {
    public static void main(String[] args) throws Exception {
        var root = Path.of(args[0]).toAbsolutePath();
        Files.createDirectories(root.resolve("directory"));
        Files.writeString(root.resolve("한글 🐇 #%.java"), "class Example {}\n");
        var count = 0;
        for (var path : new Path[] {root, root.resolve("directory"), root.resolve("missing.java"),
                root.resolve("한글 🐇 #%.java"), root.resolve("a/../missing.java"),
                Path.of(""), Path.of("relative path/한글.java"), Path.of("/")}) {
            var expected = path.toUri();
            var actual = BrowserPlatformIO.toUri(path);
            if (!expected.equals(actual) || !expected.toASCIIString().equals(actual.toASCIIString()))
                throw new AssertionError(path + " URI differs: " + expected + " / " + actual);
            if (!Path.of(expected).equals(BrowserPlatformIO.pathOf(expected)))
                throw new AssertionError("URI-to-path differs: " + expected);
            if (!path.toFile().toPath().equals(BrowserPlatformIO.toPath(path.toFile())))
                throw new AssertionError("File-to-path differs: " + path);
            count += 3;
        }
        for (var value : new String[] {"file://host/example", "file:///example?query", "file:///example#fragment"}) {
            var uri = URI.create(value);
            try { Path.of(uri); throw new AssertionError("Native URI unexpectedly accepted"); }
            catch (IllegalArgumentException expected) {}
            try { BrowserPlatformIO.pathOf(uri); throw new AssertionError("Adapter URI unexpectedly accepted"); }
            catch (IllegalArgumentException expected) {}
            count++;
        }
        var directory = root.resolve("directory");
        Files.createDirectories(directory);
        BrowserPlatformIO.createDirectories(directory);
        BrowserPlatformIO.createDirectories(directory);
        count++;
        try {
            BrowserPlatformIO.createDirectories(root.resolve("한글 🐇 #%.java"));
            throw new AssertionError("Existing file accepted as a directory");
        } catch (java.nio.file.FileAlreadyExistsException expected) { count++; }
        var text = "한글 🐇\n".repeat(4000);
        var original = new StringWriter();
        var adapted = new StringWriter();
        var length = new StringReader(text).transferTo(original);
        if (length != BrowserPlatformIO.transferTo(new StringReader(text), adapted)
                || !original.toString().equals(adapted.toString())) throw new AssertionError("Reader transfer differs");
        System.out.println("Native JDK platform IO parity: " + (count + 1) + " checks");
    }
}
