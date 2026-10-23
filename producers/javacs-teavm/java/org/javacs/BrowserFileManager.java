package org.javacs;

import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipInputStream;
import javax.tools.*;
import org.wasmidle.javacs.BrowserPlatformIO;

/** Browser filesystem adapter; Java syntax and semantics remain in the original javac. */
public final class BrowserFileManager implements StandardJavaFileManager {
    private static final Map<String, Map<String, ClassFile>> MODULES = new LinkedHashMap<>();
    private final Map<Location, List<Path>> locations = new HashMap<>();

    static void installSdk(byte[] archive) throws IOException {
        MODULES.clear();
        try (var zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                if (entry.isDirectory()) continue;
                var name = entry.getName();
                var slash = name.indexOf('/');
                if (slash < 1 || !name.endsWith(".class")) continue;
                var module = name.substring(0, slash);
                var path = name.substring(slash + 1);
                MODULES.computeIfAbsent(module, unused -> new LinkedHashMap<>())
                        .put(path, new ClassFile(module, path, zip.readAllBytes()));
            }
        }
        if (!MODULES.containsKey("java.base")) throw new IOException("Missing original java.base classes");
    }

    static Set<String> platformClassNames() {
        var result = new HashSet<String>();
        for (var files : MODULES.values()) {
            for (var name : files.keySet()) {
                if (!name.contains("$") && !name.equals("module-info.class")) {
                    result.add(name.substring(0, name.length() - 6).replace('/', '.'));
                }
            }
        }
        return result;
    }

    public static StandardJavaFileManager create() { return new BrowserFileManager(); }

    private static final class ModuleLocation implements Location {
        final String module;
        ModuleLocation(String module) { this.module = module; }
        public String getName() { return "SYSTEM_MODULES[" + module + "]"; }
        public boolean isOutputLocation() { return false; }
        public boolean isModuleOrientedLocation() { return false; }
    }

    private static final class ClassFile extends SimpleJavaFileObject {
        final String module, path;
        final byte[] bytes;
        ClassFile(String module, String path, byte[] bytes) {
            super(URI.create("jrt:/" + module + "/" + path), Kind.CLASS);
            this.module = module; this.path = path; this.bytes = bytes;
        }
        public InputStream openInputStream() { return new ByteArrayInputStream(bytes); }
        public long getLastModified() { return 0; }
    }

    private static final class DiskFile extends SimpleJavaFileObject {
        final Path path;
        DiskFile(Path path) { super(path.toAbsolutePath().toUri(), kind(path)); this.path = path; }
        private static Kind kind(Path path) {
            var name = path.toString();
            return name.endsWith(".java") ? Kind.SOURCE : name.endsWith(".class") ? Kind.CLASS : Kind.OTHER;
        }
        public InputStream openInputStream() throws IOException { return Files.newInputStream(path); }
        public CharSequence getCharContent(boolean ignoreEncodingErrors) throws IOException { return Files.readString(path); }
        public Reader openReader(boolean ignoreEncodingErrors) throws IOException { return Files.newBufferedReader(path); }
        public OutputStream openOutputStream() throws IOException {
            BrowserPlatformIO.createDirectories(path.getParent()); return Files.newOutputStream(path);
        }
        public Writer openWriter() throws IOException { return new OutputStreamWriter(openOutputStream(), StandardCharsets.UTF_8); }
        public long getLastModified() {
            try { return Files.getLastModifiedTime(path).toMillis(); } catch (IOException e) { return 0; }
        }
    }

    public ClassLoader getClassLoader(Location location) { return BrowserFileManager.class.getClassLoader(); }
    public Iterable<JavaFileObject> list(Location location, String pkg, Set<JavaFileObject.Kind> kinds, boolean recurse)
            throws IOException {
        var result = new ArrayList<JavaFileObject>();
        var prefix = pkg.isEmpty() ? "" : pkg.replace('.', '/') + "/";
        if (kinds.contains(JavaFileObject.Kind.CLASS)) {
            Collection<Map<String, ClassFile>> maps = List.of();
            if (location instanceof ModuleLocation) {
                var files = MODULES.get(((ModuleLocation) location).module);
                if (files != null) maps = List.of(files);
            } else if (location == StandardLocation.PLATFORM_CLASS_PATH) maps = MODULES.values();
            for (var files : maps) {
                for (var entry : files.entrySet()) {
                    var name = entry.getKey();
                    if (name.startsWith(prefix) && (recurse || name.indexOf('/', prefix.length()) < 0)) {
                        result.add(entry.getValue());
                    }
                }
            }
        }
        for (var root : locations.getOrDefault(location, List.of())) {
            var dir = root.resolve(prefix);
            if (!Files.isDirectory(dir)) continue;
            try (var stream = Files.walk(dir, recurse ? Integer.MAX_VALUE : 1)) {
                stream.filter(Files::isRegularFile).map(DiskFile::new)
                        .filter(file -> kinds.contains(file.getKind())).forEach(result::add);
            }
        }
        return result;
    }

    public String inferBinaryName(Location location, JavaFileObject file) {
        if (file instanceof ClassFile) {
            var path = ((ClassFile) file).path;
            return path.substring(0, path.length() - 6).replace('/', '.');
        }
        if (file instanceof DiskFile) {
            for (var root : locations.getOrDefault(location, List.of())) {
                var path = root.relativize(((DiskFile) file).path).toString();
                return path.substring(0, path.lastIndexOf('.')).replace('/', '.');
            }
        }
        return null;
    }
    public boolean isSameFile(FileObject a, FileObject b) { return a.toUri().equals(b.toUri()); }
    public boolean handleOption(String current, Iterator<String> remaining) {
        if ((current.equals("-classpath") || current.equals("-cp") || current.equals("--class-path")) && remaining.hasNext()) {
            if (!remaining.next().isEmpty()) throw new UnsupportedOperationException("External class paths are unavailable in this browser profile");
            return true;
        }
        return false;
    }
    public boolean hasLocation(Location location) {
        return location instanceof ModuleLocation || location == StandardLocation.SYSTEM_MODULES
                || location == StandardLocation.PLATFORM_CLASS_PATH || locations.containsKey(location);
    }
    public JavaFileObject getJavaFileForInput(Location location, String className, JavaFileObject.Kind kind) throws IOException {
        return (JavaFileObject) getFileForInput(location, "", className.replace('.', '/') + kind.extension);
    }
    public JavaFileObject getJavaFileForOutput(Location location, String name, JavaFileObject.Kind kind, FileObject sibling)
            throws IOException { return (JavaFileObject) getFileForOutput(location, "", name.replace('.', '/') + kind.extension, sibling); }
    public FileObject getFileForInput(Location location, String pkg, String relative) {
        var name = (pkg.isEmpty() ? "" : pkg.replace('.', '/') + "/") + relative;
        if (location instanceof ModuleLocation) {
            var files = MODULES.get(((ModuleLocation) location).module);
            return files == null ? null : files.get(name);
        }
        if (location == StandardLocation.PLATFORM_CLASS_PATH) {
            for (var files : MODULES.values()) if (files.containsKey(name)) return files.get(name);
        }
        for (var root : locations.getOrDefault(location, List.of())) {
            var path = root.resolve(name);
            if (Files.isRegularFile(path)) return new DiskFile(path);
        }
        return null;
    }
    public FileObject getFileForOutput(Location location, String pkg, String relative, FileObject sibling) {
        var root = locations.getOrDefault(location, List.of(Path.of("/tmp/javacs-output"))).get(0);
        return new DiskFile(root.resolve(pkg.replace('.', '/')).resolve(relative));
    }
    public void flush() {}
    public void close() {}
    public int isSupportedOption(String option) { return option.equals("-classpath") || option.equals("-cp") ? 1 : -1; }
    public Iterable<JavaFileObject> getJavaFileObjectsFromFiles(Iterable<? extends File> files) {
        var result = new ArrayList<JavaFileObject>(); for (var file : files) result.add(new DiskFile(file.toPath())); return result;
    }
    public Iterable<JavaFileObject> getJavaFileObjects(File... files) { return getJavaFileObjectsFromFiles(List.of(files)); }
    public Iterable<JavaFileObject> getJavaFileObjectsFromStrings(Iterable<String> names) {
        var result = new ArrayList<JavaFileObject>(); for (var name : names) result.add(new DiskFile(Path.of(name))); return result;
    }
    public Iterable<JavaFileObject> getJavaFileObjects(String... names) { return getJavaFileObjectsFromStrings(List.of(names)); }
    public void setLocation(Location location, Iterable<? extends File> files) {
        var paths = new ArrayList<Path>(); if (files != null) for (var file : files) paths.add(file.toPath()); locations.put(location, paths);
    }
    public Iterable<? extends File> getLocation(Location location) {
        var result = new ArrayList<File>(); for (var path : locations.getOrDefault(location, List.of())) result.add(path.toFile()); return result;
    }
    public Iterable<Set<Location>> listLocationsForModules(Location location) {
        if (location != StandardLocation.SYSTEM_MODULES) return List.of();
        var result = new ArrayList<Set<Location>>(); for (var module : MODULES.keySet()) result.add(Set.of(new ModuleLocation(module))); return result;
    }
    public Location getLocationForModule(Location location, String moduleName) {
        if (location != StandardLocation.SYSTEM_MODULES) return null;
        return MODULES.containsKey(moduleName) ? new ModuleLocation(moduleName) : null;
    }
    public Location getLocationForModule(Location location, JavaFileObject file) {
        return location == StandardLocation.SYSTEM_MODULES && file instanceof ClassFile
                ? new ModuleLocation(((ClassFile) file).module) : null;
    }
    public String inferModuleName(Location location) { return location instanceof ModuleLocation ? ((ModuleLocation) location).module : null; }
    public boolean contains(Location location, FileObject file) {
        if (!(file instanceof ClassFile)) return false;
        var entry = (ClassFile) file;
        if (location instanceof ModuleLocation && !((ModuleLocation) location).module.equals(entry.module)) return false;
        if (!(location instanceof ModuleLocation) && location != StandardLocation.PLATFORM_CLASS_PATH) return false;
        var files = MODULES.get(entry.module);
        return files != null && files.get(entry.path) == entry;
    }
}
