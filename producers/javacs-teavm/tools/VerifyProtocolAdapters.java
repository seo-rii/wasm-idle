import com.google.gson.*;
import java.lang.reflect.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import org.wasmidle.javacs.ProtocolAdapters;

/** Differential oracle: generated static DTO adapters versus unchanged upstream Gson on the JVM. */
public final class VerifyProtocolAdapters {
    private static final Gson ORIGINAL = new Gson();
    private static final Gson STATIC = new GsonBuilder().registerTypeAdapterFactory(new ProtocolAdapters()).create();
    private static int serializations, typedReads, originalReadErrors;

    private static Object sample(Type type, int depth) throws Exception {
        if (type instanceof ParameterizedType) {
            var p = (ParameterizedType) type;
            if (Collection.class.isAssignableFrom((Class<?>) p.getRawType())) {
                var list = new ArrayList<Object>(); if (depth > 0) list.add(sample(p.getActualTypeArguments()[0], depth - 1)); return list;
            }
            var map = new LinkedHashMap<Object, Object>();
            if (depth > 0) map.put(sample(p.getActualTypeArguments()[0], depth - 1), sample(p.getActualTypeArguments()[1], depth - 1));
            return map;
        }
        var cls = (Class<?>) type;
        if (cls == boolean.class || cls == Boolean.class) return true;
        if (cls == int.class || cls == Integer.class) return 7;
        if (cls == long.class || cls == Long.class) return 19L;
        if (cls == float.class || cls == Float.class) return 2.5f;
        if (cls == double.class || cls == Double.class) return 3.5;
        if (cls == char.class || cls == Character.class) return '한';
        if (cls == String.class) return "Korean 한글 and emoji 😀 <xml> & quotes \"";
        if (cls == URI.class) return URI.create("file:///workspace/한글%20file.java");
        if (cls == JsonObject.class || cls == JsonElement.class) return new JsonParser().parse("{\"nullable\":null,\"mixed\":[true,7,\"한글😀\"]}");
        if (cls == JsonArray.class) return new JsonParser().parse("[null,true,7,\"한글😀\"]").getAsJsonArray();
        if (cls == Object.class) return Map.of("mixed", List.of(true, 7, "한글😀"));
        if (cls.isArray()) {
            var result = Array.newInstance(cls.getComponentType(), depth > 0 ? 1 : 0);
            if (depth > 0) Array.set(result, 0, sample(cls.getComponentType(), depth - 1)); return result;
        }
        if (depth < 0) return null;
        var result = cls.getConstructor().newInstance();
        for (var current = cls; current != Object.class; current = current.getSuperclass()) {
            for (var field : current.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) || Modifier.isTransient(field.getModifiers()) || field.isSynthetic()) continue;
                field.setAccessible(true); field.set(result, sample(field.getGenericType(), depth - 1));
            }
        }
        return result;
    }

    private static void check(Object instance, Class<?> type) {
        var expected = ORIGINAL.toJsonTree(instance);
        var actual = STATIC.toJsonTree(instance);
        if (!expected.equals(actual)) throw new AssertionError(type + " serialization\n" + expected + "\n" + actual);
        serializations++;
        Object original = null, adapted = null;
        RuntimeException originalError = null, adaptedError = null;
        try { original = ORIGINAL.fromJson(expected, type); } catch (RuntimeException e) { originalError = e; }
        try { adapted = STATIC.fromJson(expected, type); } catch (RuntimeException e) { adaptedError = e; }
        if (originalError != null || adaptedError != null) {
            if (originalError == null || adaptedError == null || originalError.getClass() != adaptedError.getClass()) {
                throw new AssertionError(type + " read errors differ", adaptedError);
            }
            originalReadErrors++; return;
        }
        if (!ORIGINAL.toJsonTree(original).equals(ORIGINAL.toJsonTree(adapted))) throw new AssertionError(type + " typed generic fields differ");
        typedReads++;
    }

    public static void main(String[] args) throws Exception {
        var types = new ArrayList<Class<?>>();
        try (var paths = Files.list(Path.of(args[0], "org/javacs/lsp"))) {
            for (var file : paths.sorted().toList()) {
                var name = file.getFileName().toString(); if (!name.endsWith(".class") || name.contains("$")) continue;
                var cls = Class.forName("org.javacs.lsp." + name.substring(0, name.length() - 6));
                if (!Modifier.isPublic(cls.getModifiers()) || cls.isInterface() || Modifier.isAbstract(cls.getModifiers())) continue;
                boolean fields = false;
                for (var current = cls; current != Object.class; current = current.getSuperclass()) for (var field : current.getDeclaredFields()) {
                    if (!Modifier.isStatic(field.getModifiers()) && !Modifier.isTransient(field.getModifiers()) && !field.isSynthetic()) fields = true;
                }
                if (fields) types.add(cls);
            }
        }
        types.add(Class.forName("org.javacs.CompletionData"));
        types.add(Class.forName("org.javacs.markup.SemanticColors"));
        for (var type : types) { check(type.getConstructor().newInstance(), type); check(sample(type, 5), type); }
        System.out.println("Original Gson parity: " + types.size() + " DTOs, " + serializations + " serializations, " + typedReads + " typed reads, " + originalReadErrors + " identical original unsupported reads");
    }
}
