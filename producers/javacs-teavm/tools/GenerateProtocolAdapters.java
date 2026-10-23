import com.google.gson.annotations.JsonAdapter;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

/** Build-time reflection only. Emits exact field/generic-type adapters for upstream javacs DTOs. */
public final class GenerateProtocolAdapters {
    private final List<Class<?>> classes = new ArrayList<>();
    private final Map<Type, String> readers = new LinkedHashMap<>();
    private final StringBuilder methods = new StringBuilder();

    private static String name(Class<?> cls) { return cls.getCanonicalName(); }
    private static String sourceType(Type type) { return type.getTypeName().replace('$', '.'); }
    private static String quote(String text) { return '"' + text.replace("\\", "\\\\").replace("\"", "\\\"") + '"'; }
    private static List<Field> fields(Class<?> cls) {
        var fields = new ArrayList<Field>();
        for (var current = cls; current != Object.class; current = current.getSuperclass()) {
            for (var field : current.getDeclaredFields()) {
                if (!Modifier.isStatic(field.getModifiers()) && !Modifier.isTransient(field.getModifiers()) && !field.isSynthetic()) fields.add(field);
            }
        }
        return fields;
    }
    private static String get(Field field, String value) {
        if (Modifier.isPublic(field.getModifiers())) return value + "." + field.getName();
        var suffix = Character.toUpperCase(field.getName().charAt(0)) + field.getName().substring(1);
        try { field.getDeclaringClass().getMethod("get" + suffix); }
        catch (ReflectiveOperationException e) { throw new IllegalStateException("Private DTO field lacks getter: " + field, e); }
        return value + ".get" + suffix + "()";
    }
    private static String set(Field field, String value) {
        if (Modifier.isPublic(field.getModifiers())) return "result." + field.getName() + " = " + value + ";";
        var suffix = Character.toUpperCase(field.getName().charAt(0)) + field.getName().substring(1);
        try { field.getDeclaringClass().getMethod("set" + suffix, field.getType()); }
        catch (ReflectiveOperationException e) { throw new IllegalStateException("Private DTO field lacks setter: " + field, e); }
        return "result.set" + suffix + "(" + value + ");";
    }

    private String read(Type type, String value) {
        if (type instanceof Class<?>) {
            var cls = (Class<?>) type;
            String expression = null;
            if (cls == String.class) expression = value + ".getAsString()";
            else if (cls == char.class || cls == Character.class) expression = "com.google.gson.internal.bind.TypeAdapters.CHARACTER.fromJsonTree(" + value + ")";
            else if (cls == boolean.class || cls == Boolean.class) expression = value + ".getAsBoolean()";
            else if (cls == int.class || cls == Integer.class) expression = value + ".getAsInt()";
            else if (cls == long.class || cls == Long.class) expression = value + ".getAsLong()";
            else if (cls == float.class || cls == Float.class) expression = value + ".getAsFloat()";
            else if (cls == double.class || cls == Double.class) expression = value + ".getAsDouble()";
            else if (cls == byte.class || cls == Byte.class) expression = value + ".getAsByte()";
            else if (cls == short.class || cls == Short.class) expression = value + ".getAsShort()";
            else if (cls == java.net.URI.class) expression = "com.google.gson.internal.bind.TypeAdapters.URI.fromJsonTree(" + value + ")";
            else if (com.google.gson.JsonElement.class.isAssignableFrom(cls)) expression = "(" + name(cls) + ") " + value;
            else if (cls == Object.class) expression = "untyped(" + value + ")";
            if (expression != null) return cls.isPrimitive() ? expression : "(" + value + ".isJsonNull() ? null : " + expression + ")";
        }
        var helper = readers.get(type);
        if (helper == null) {
            helper = "read" + readers.size(); readers.put(type, helper);
        }
        return helper + "(" + value + ")";
    }

    private void emitReader(Type type, String method) {
        var resultType = sourceType(type);
        methods.append("private static ").append(resultType).append(' ').append(method).append("(JsonElement value) {\n")
            .append("if (value == null || value.isJsonNull()) return null;\n");
        if (type instanceof ParameterizedType) {
            var parameterized = (ParameterizedType) type;
            var raw = (Class<?>) parameterized.getRawType();
            var arguments = parameterized.getActualTypeArguments();
            if (Collection.class.isAssignableFrom(raw)) {
                methods.append("var result = new java.util.ArrayList<").append(sourceType(arguments[0])).append(">();\n")
                    .append("for (var item : value.getAsJsonArray()) result.add(").append(read(arguments[0], "item")).append(");\nreturn result;\n");
            } else if (Map.class.isAssignableFrom(raw)) {
                methods.append("var result = new java.util.LinkedHashMap<").append(sourceType(arguments[0])).append(',').append(sourceType(arguments[1])).append(">();\n")
                    .append("for (var entry : value.getAsJsonObject().entrySet()) { var key = new JsonPrimitive(entry.getKey()); var item = entry.getValue();\n")
                    .append("result.put(").append(read(arguments[0], "key")).append(',').append(read(arguments[1], "item")).append("); }\nreturn result;\n");
            } else throw new IllegalStateException("Unsupported generic DTO field: " + type);
        } else {
            var cls = (Class<?>) type;
            if (cls.isArray()) {
                var component = cls.getComponentType();
                methods.append("var array = value.getAsJsonArray(); var result = new ").append(name(component)).append("[array.size()];\n")
                    .append("for (int index = 0; index < result.length; index++) { var item = array.get(index); result[index] = ")
                    .append(read(component, "item")).append("; }\nreturn result;\n");
            } else {
                var adapter = cls.getAnnotation(JsonAdapter.class);
                if (adapter != null) {
                    methods.append("return new ").append(name(adapter.value())).append("().fromJsonTree(value);\n");
                } else {
                    if (!classes.contains(cls)) throw new IllegalStateException("Unsupported DTO type: " + cls);
                    try { cls.getConstructor(); }
                    catch (NoSuchMethodException e) { throw new IllegalStateException("Original DTO needs a constructor adapter: " + cls, e); }
                    methods.append("var object = value.getAsJsonObject(); var result = new ").append(name(cls)).append("();\n");
                    for (var field : fields(cls)) {
                        if (Modifier.isFinal(field.getModifiers())) throw new IllegalStateException("Final DTO field needs a constructor adapter: " + field);
                        var key = quote(field.getName());
                        methods.append("if (object.has(").append(key).append(')');
                        if (field.getType().isPrimitive()) methods.append(" && !object.get(").append(key).append(").isJsonNull()");
                        methods.append(") { var item = object.get(").append(key).append("); ")
                            .append(set(field, read(field.getGenericType(), "item"))).append(" }\n");
                    }
                    methods.append("return result;\n");
                }
            }
        }
        methods.append("}\n");
    }

    private String generate(Path input) throws Exception {
        try (var paths = Files.list(input.resolve("org/javacs/lsp"))) {
            for (var file : paths.sorted().collect(Collectors.toList())) {
                var filename = file.getFileName().toString();
                if (!filename.endsWith(".class") || filename.contains("$")) continue;
                var cls = Class.forName("org.javacs.lsp." + filename.substring(0, filename.length() - 6), false, getClass().getClassLoader());
                if (Modifier.isPublic(cls.getModifiers()) && !cls.isInterface() && !Modifier.isAbstract(cls.getModifiers()) && !fields(cls).isEmpty()) classes.add(cls);
            }
        }
        classes.add(Class.forName("org.javacs.CompletionData"));
        classes.add(Class.forName("org.javacs.markup.SemanticColors"));
        for (var cls : classes) read(cls, "value");
        for (int index = 0; index < readers.size(); index++) {
            var entry = new ArrayList<>(readers.entrySet()).get(index);
            emitReader(entry.getKey(), entry.getValue());
        }
        var source = new StringBuilder("package org.wasmidle.javacs;\nimport com.google.gson.*;\nimport com.google.gson.internal.Streams;\nimport com.google.gson.reflect.TypeToken;\nimport com.google.gson.stream.*;\nimport java.io.IOException;\npublic final class ProtocolAdapters implements TypeAdapterFactory {\n")
            .append("@SuppressWarnings(\"unchecked\") public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> token) { var raw = token.getRawType();\n")
            .append("if (!(java.util.Collection.class.isAssignableFrom(raw) || java.util.Map.class.isAssignableFrom(raw)");
        for (var cls : classes) source.append(" || raw == ").append(name(cls)).append(".class");
        source.append(")) return null;\nreturn new TypeAdapter<T>() { public T read(JsonReader input) throws IOException { return (T) decode(raw, Streams.parse(input)); } public void write(JsonWriter output, T value) throws IOException { Streams.write(encode(value), output); } }; }\n")
            .append("private static Object decode(Class<?> raw, JsonElement value) {\n");
        for (var cls : classes) source.append("if (raw == ").append(name(cls)).append(".class) return ").append(readers.get(cls)).append("(value);\n");
        source.append("return untyped(value); }\n")
            .append("private static Object untyped(JsonElement value) { if (value == null || value.isJsonNull()) return null; if (value.isJsonArray()) { var result = new java.util.ArrayList<Object>(); for (var item : value.getAsJsonArray()) result.add(untyped(item)); return result; } if (value.isJsonObject()) { var result = new java.util.LinkedHashMap<String,Object>(); for (var entry : value.getAsJsonObject().entrySet()) result.put(entry.getKey(),untyped(entry.getValue())); return result; } var primitive=value.getAsJsonPrimitive(); return primitive.isBoolean() ? primitive.getAsBoolean() : primitive.isNumber() ? primitive.getAsDouble() : primitive.getAsString(); }\n")
            .append("private static JsonElement encode(Object value) { if (value == null) return JsonNull.INSTANCE; if (value instanceof JsonElement) return (JsonElement)value; if (value instanceof Boolean) return new JsonPrimitive((Boolean)value); if (value instanceof Number) return new JsonPrimitive((Number)value); if (value instanceof Character) return new JsonPrimitive((Character)value); if (value instanceof String) return new JsonPrimitive((String)value); if (value instanceof java.net.URI) return new JsonPrimitive(((java.net.URI)value).toASCIIString()); if (value instanceof java.util.Collection) { var result=new JsonArray(); for (var item : (java.util.Collection<?>)value) result.add(encode(item)); return result; } if (value instanceof java.util.Map) { var result=new JsonObject(); for (var entry : ((java.util.Map<?,?>)value).entrySet()) result.add(String.valueOf(entry.getKey()), encode(entry.getValue())); return result; } if (value.getClass().isArray()) { var result=new JsonArray(); for (int i=0;i<java.lang.reflect.Array.getLength(value);i++) result.add(encode(java.lang.reflect.Array.get(value,i))); return result; }\n");
        classes.sort(Comparator.<Class<?>>comparingInt(cls -> { int count=0; for(var parent=cls.getSuperclass();parent!=null;parent=parent.getSuperclass()) count++; return -count; }).thenComparing(Class::getName));
        for (var cls : classes) {
            source.append("if (value instanceof ").append(name(cls)).append(") { var item = (").append(name(cls)).append(")value;\n");
            var adapter = cls.getAnnotation(JsonAdapter.class);
            if (adapter != null) source.append("return new ").append(name(adapter.value())).append("().toJsonTree(item);\n");
            else {
                source.append("var result = new JsonObject();\n");
                for (var field : fields(cls)) {
                    var expression = get(field, "item");
                    if (!field.getType().isPrimitive()) source.append("if (").append(expression).append(" != null) ");
                    source.append("result.add(").append(quote(field.getName())).append(", encode(").append(expression).append("));\n");
                }
                source.append("return result;\n");
            }
            source.append("}\n");
        }
        source.append("throw new IllegalArgumentException(\"Unregistered javacs protocol value: \"+value.getClass().getName()); }\n")
            .append(methods).append("}\n");
        System.out.println("Generated exact static DTO adapters for " + classes.size() + " original classes, " + readers.size() + " concrete field types");
        return source.toString();
    }

    public static void main(String[] args) throws Exception {
        var target = Path.of(args[1]); Files.createDirectories(target.getParent());
        Files.writeString(target, new GenerateProtocolAdapters().generate(Path.of(args[0])));
    }
}
