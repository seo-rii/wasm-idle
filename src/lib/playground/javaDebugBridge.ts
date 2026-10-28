/** Values stay in the real Java VM while a stopped hook services inspection requests. */
export function createJavaDebugBridge(className: string, packageName = 'wasm_idle_debug') {
	if (![className, packageName].every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
		throw new Error('Invalid Java debugger helper name');
	return {
		qualifiedName: `${packageName}.${className}`,
		sourceFileName: `${className}.java`,
		source: String.raw`package ${packageName};
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;
import org.teavm.jso.core.JSString;
import org.teavm.jso.core.JSNumber;
import java.util.ArrayList;
import java.lang.String;
import java.lang.StringBuilder;
import java.lang.Throwable;
import java.lang.StackTraceElement;

public final class ${className} {
    public interface Inspectable {
        Class<?> ${className}_fieldOwner();
        int ${className}_fieldCount();
        Field ${className}_field(int index);
    }
    public static final class Field {
        final String name;
        final String type;
        final Object value;
        public Field(String name, String type, Object value) {
            this.name = name; this.type = type; this.value = value;
        }
    }
    private static final class Captured {
        final String kind;
        final Object value;
        Captured(String kind, Object value) { this.kind = kind; this.value = value; }
    }
    public static Object capture(boolean value) { return new Captured("boolean", value); }
    public static Object capture(byte value) { return new Captured("byte", value); }
    public static Object capture(short value) { return new Captured("short", value); }
    public static Object capture(char value) { return new Captured("char", value); }
    public static Object capture(int value) { return new Captured("int", value); }
    public static Object capture(long value) { return new Captured("long", value); }
    public static Object capture(float value) { return new Captured("float", value); }
    public static Object capture(double value) { return new Captured("double", value); }
    public static Object capture(String value) { return new Captured("java.lang.String", value); }
    public static Object capture(Object value) { return new Captured("reference", value); }
    private static String quote(String value) {
        if (value == null) return "null";
        StringBuilder text = new StringBuilder("\"");
        String hex = "0123456789abcdef";
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\\' || c == '"') text.append('\\').append(c);
            else if (c < 32 || (c >= 0xd800 && c <= 0xdfff)) {
                text.append("\\u").append(hex.charAt((c >>> 12) & 15))
                    .append(hex.charAt((c >>> 8) & 15)).append(hex.charAt((c >>> 4) & 15))
                    .append(hex.charAt(c & 15));
            } else text.append(c);
        }
        return text.append('"').toString();
    }
    private static JSObject target() {
        Window window = Window.current();
        if (window == null) return null;
        JSMapLike<JSObject> globals = window.cast();
        return globals.get("wasmIdleJavaDebug");
    }
    public static boolean poll(String source, int line, int column) {
        JSObject target = target();
        if (target == null) return false;
        JSMapLike<JSObject> methods = target.cast();
        JSFunction poll = methods.get("poll").cast();
        return poll.call(target, JSString.valueOf(source), JSNumber.valueOf(line), JSNumber.valueOf(column)) != null;
    }
    public static void hit(String source, int line, int column) {
        if (poll(source, line, column)) hit(source, line, column, new String[0], new String[0], new Object[0]);
    }
    public static void hit(String source, int line, int column, String[] names, String[] types, Object[] values) {
        JSObject target = target();
        if (target == null) return;
        JSMapLike<JSObject> methods = target.cast();
        Snapshot snapshot = new Snapshot(names, types, values);
        StackTraceElement[] frames = new Throwable().getStackTrace();
        StringBuilder result = new StringBuilder("[");
        for (int i = 0; i < frames.length && i < 64; i++) {
            if (i > 0) result.append(',');
            StackTraceElement frame = frames[i];
            result.append('[').append(quote(frame.getClassName())).append(',')
                .append(quote(frame.getMethodName())).append(',')
                .append(quote(frame.getFileName())).append(',')
                .append(frame.getLineNumber()).append(']');
        }
        result.append(']');
        JSFunction pause = methods.get("pause").cast();
        JSObject request = (JSObject) pause.call(target, JSString.valueOf(source), JSNumber.valueOf(line),
            JSNumber.valueOf(column), JSString.valueOf(result.toString()), JSNumber.valueOf(frames.length),
            JSString.valueOf(snapshot.variables(0, 0, 50)), JSNumber.valueOf(names.length));
        while (request != null) {
            JSMapLike<JSObject> fields = request.cast();
            int id = ((JSNumber) fields.get("id")).intValue();
            int stopId = ((JSNumber) fields.get("stopId")).intValue();
            String op = ((JSString) fields.get("op")).stringValue();
            String response = null;
            String error = null;
            try {
                if (op.equals("context")) response = snapshot.context();
                else if (op.equals("variables")) response = snapshot.variables(
                    ((JSNumber) fields.get("reference")).intValue(),
                    ((JSNumber) fields.get("start")).intValue(),
                    ((JSNumber) fields.get("count")).intValue());
                else throw new IllegalArgumentException("Unknown Java inspection request");
            } catch (Throwable failure) {
                error = failure.getClass().getName() + ": " + failure.getMessage();
            }
            JSFunction reply = methods.get("reply").cast();
            request = (JSObject) reply.call(target, JSNumber.valueOf(id), JSNumber.valueOf(stopId),
                response == null ? null : JSString.valueOf(response),
                error == null ? null : JSString.valueOf(error));
        }
    }

    private static final class Snapshot {
        final String[] names;
        final String[] types;
        final String[] kinds;
        final Object[] values;
        final ArrayList<Object> handles = new ArrayList<Object>();
        Snapshot(String[] names, String[] types, Object[] values) {
            if (names.length != types.length || names.length != values.length || names.length > 1024)
                throw new IllegalArgumentException("Invalid Java local snapshot");
            this.names = names;
            this.types = types;
            this.values = new Object[values.length];
            this.kinds = new String[values.length];
            for (int i = 0; i < values.length; i++) {
                if (!(values[i] instanceof Captured)) throw new IllegalArgumentException("Missing Java static capture type");
                Captured captured = (Captured) values[i];
                this.values[i] = captured.value;
                this.kinds[i] = captured.kind;
            }
        }
        int handle(Object value) {
            for (int i = 0; i < handles.size(); i++) if (handles.get(i) == value) return i + 1;
            if (handles.size() >= 4096) return 0;
            handles.add(value);
            return handles.size();
        }
        int length(Object value) {
            if (value instanceof Object[]) return ((Object[]) value).length;
            if (value instanceof int[]) return ((int[]) value).length;
            if (value instanceof long[]) return ((long[]) value).length;
            if (value instanceof byte[]) return ((byte[]) value).length;
            if (value instanceof short[]) return ((short[]) value).length;
            if (value instanceof char[]) return ((char[]) value).length;
            if (value instanceof boolean[]) return ((boolean[]) value).length;
            if (value instanceof float[]) return ((float[]) value).length;
            if (value instanceof double[]) return ((double[]) value).length;
            return -1;
        }
        Inspectable fields(Object value) {
            if (!(value instanceof Inspectable)) return null;
            // A proxy can discover the generated interface at runtime and dispatch
            // its methods into a user InvocationHandler. Proxy classes extend Proxy
            // directly; test trusted class metadata before dispatch, without linking
            // java.lang.reflect.Proxy (absent from the pinned browser SDK).
            Class<?> parent = value.getClass().getSuperclass();
            if (parent != null && parent.getName().equals("java.lang.reflect.Proxy")) return null;
            Inspectable fields = (Inspectable) value;
            // An uninstrumented anonymous subclass must not inherit a partial inspector.
            return fields.${className}_fieldOwner() == value.getClass() ? fields : null;
        }
        Object element(Object value, int index) {
            if (value instanceof Object[]) return ((Object[]) value)[index];
            if (value instanceof int[]) return ((int[]) value)[index];
            if (value instanceof long[]) return ((long[]) value)[index];
            if (value instanceof byte[]) return ((byte[]) value)[index];
            if (value instanceof short[]) return ((short[]) value)[index];
            if (value instanceof char[]) return ((char[]) value)[index];
            if (value instanceof boolean[]) return ((boolean[]) value)[index];
            if (value instanceof float[]) return ((float[]) value)[index];
            if (value instanceof double[]) return ((double[]) value)[index];
            throw new IllegalArgumentException("Java object has no indexed children");
        }
        String scalarType(Object value) {
            if (value instanceof String) return "java.lang.String";
            if (value instanceof Boolean) return "boolean";
            if (value instanceof Character) return "char";
            if (value instanceof Byte) return "byte";
            if (value instanceof Short) return "short";
            if (value instanceof Integer) return "int";
            if (value instanceof Long) return "long";
            if (value instanceof Float) return "float";
            if (value instanceof Double) return "double";
            return value == null ? "null" : value.getClass().getName();
        }
        String scalar(Object value) {
            if (value instanceof String) return (String) value;
            if (value instanceof Boolean) return Boolean.toString(((Boolean) value).booleanValue());
            if (value instanceof Character) return Integer.toString(((Character) value).charValue());
            if (value instanceof Byte) return Byte.toString(((Byte) value).byteValue());
            if (value instanceof Short) return Short.toString(((Short) value).shortValue());
            if (value instanceof Integer) return Integer.toString(((Integer) value).intValue());
            if (value instanceof Long) return Long.toString(((Long) value).longValue());
            if (value instanceof Float) return Float.toString(((Float) value).floatValue());
            if (value instanceof Double) return Double.toString(((Double) value).doubleValue());
            return null;
        }
        String describe(String name, String declaredType, Object value) {
            String type = declaredType.equals("var") || declaredType.length() == 0 ? scalarType(value) : declaredType;
            String display;
            int reference = 0;
            int size = length(value);
            Inspectable fields = fields(value);
            if (value == null) display = "null";
            else if (value instanceof String) {
                String text = (String) value;
                display = quote(text.length() > 1024 ? text.substring(0, 1024) + "…" : text);
            } else if (value instanceof Character) {
                String text = quote(String.valueOf(((Character) value).charValue()));
                display = "'" + text.substring(1, text.length() - 1).replace("'", "\\'") + "'";
            }
            else if (scalar(value) != null) display = scalar(value);
            else if (size >= 0) {
                reference = handle(value);
                display = value.getClass().getName() + " (" + size + ")";
            } else {
                int identity = handle(value);
                if (fields != null) reference = identity;
                display = value.getClass().getName() + "@" + identity;
            }
            return "{\"name\":" + quote(name) + ",\"type\":" + quote(type)
                + ",\"value\":" + quote(display) + ",\"variablesReference\":" + reference
                + (size >= 0 ? ",\"indexedVariables\":" + size : "")
                + (fields != null ? ",\"namedVariables\":" + fields.${className}_fieldCount() : "") + "}";
        }
        String variables(int reference, int start, int count) {
            if (start < 0 || count < 0 || count > 1000 || reference < 0 || reference > handles.size())
                throw new IllegalArgumentException("Invalid Java variable page");
            Object target = reference == 0 ? null : handles.get(reference - 1);
            Inspectable fields = fields(target);
            int size = reference == 0 ? names.length : fields == null ? length(target) : fields.${className}_fieldCount();
            if (size < 0) throw new IllegalArgumentException("Java object has no inspectable children");
            StringBuilder result = new StringBuilder("[");
            int end = start >= size ? size : start + Math.min(count, size - start);
            for (int i = start; i < end; i++) {
                if (i > start) result.append(',');
                String type = reference == 0 && types[i].equals("var")
                    ? (kinds[i].equals("reference") ? (values[i] == null ? "null" : values[i].getClass().getName()) : kinds[i])
                    : reference == 0 ? types[i] : "";
                if (reference == 0) result.append(describe(names[i], type, values[i]));
                else if (fields != null) {
                    Field field = fields.${className}_field(i);
                    result.append(describe(field.name, field.type, field.value));
                } else result.append(describe("[" + i + "]", "", element(target, i)));
            }
            return result.append(']').toString();
        }
        String context() {
            StringBuilder result = new StringBuilder("{\"bindings\":[");
            int written = 0;
            for (int i = 0; i < names.length; i++) {
                if (names[i].equals("this")) continue;
                if (written++ > 0) result.append(',');
                Object value = values[i];
                String type = kinds[i].equals("reference") ? types[i] : kinds[i];
                String text = scalar(value);
                String unavailable = null;
                if (kinds[i].equals("reference")) unavailable = "Live Java reference expressions are not supported";
                else if (value instanceof String && ((String) value).length() > 65536) unavailable = "Java String exceeds the evaluation snapshot limit";
                result.append("{\"name\":").append(quote(names[i])).append(",\"type\":").append(quote(type))
                    .append(",\"value\":").append(quote(unavailable == null ? text : null));
                if (unavailable != null) result.append(",\"unavailable\":").append(quote(unavailable));
                result.append('}');
                if (result.length() > 900000) throw new IllegalArgumentException("Java evaluation context exceeds its limit");
            }
            return result.append("]}").toString();
        }
    }
}
`
	};
}
