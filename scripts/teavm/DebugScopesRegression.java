import java.util.HashMap;
import java.util.List;
import org.teavm.backend.wasm.debug.DebugLines;
import org.teavm.backend.wasm.debug.GCDebugInfoBuilder;
import org.teavm.backend.wasm.debug.parser.LinesDeobfuscationParser;
import org.teavm.backend.wasm.model.WasmFunction;
import org.teavm.backend.wasm.model.WasmFunctionType;
import org.teavm.backend.wasm.model.WasmModule;
import org.teavm.backend.wasm.model.instruction.WasmUnreachable;
import org.teavm.backend.wasm.render.WasmBinaryRenderer;
import org.teavm.backend.wasm.render.WasmBinaryStatsCollector;
import org.teavm.backend.wasm.render.WasmBinaryVersion;
import org.teavm.backend.wasm.render.WasmBinaryWriter;
import org.teavm.model.InliningInfo;
import org.teavm.model.MethodReference;
import org.teavm.model.TextLocation;
import org.teavm.model.ValueType;

/** Native regression: a final inlined instruction must not swallow later functions' debug records. */
public class DebugScopesRegression {
    public static void main(String[] args) {
        var module = new WasmModule();
        var type = new WasmFunctionType("test", List.of(), List.of());
        module.types.add(type);
        var first = new MethodReference("test.Main", "first", ValueType.VOID);
        var second = new MethodReference("test.Main", "second", ValueType.VOID);
        var outer = new InliningInfo(new MethodReference("test.Helper", "outer", ValueType.VOID),
                "Main.java", 3, null);
        var inner = new InliningInfo(new MethodReference("test.Helper", "inner", ValueType.VOID),
                "Helper.java", 7, outer);
        for (var method : List.of(first, second)) {
            var function = new WasmFunction(type);
            function.setName(method.getName());
            function.setJavaMethod(method);
            var location = new TextLocation(method == first ? "Helper.java" : "Main.java",
                    method == first ? 11 : 9, method == first ? inner : null);
            function.getBody().add(new WasmUnreachable(), location);
            function.getBody().add(new WasmUnreachable(), location);
            module.functions.add(function);
        }
        var debug = new GCDebugInfoBuilder();
        var lines = debug.lines();
        int[] depth = {0};
        int[] starts = {0};
        var observed = new DebugLines() {
            public void advance(int address) { lines.advance(address); }
            public void location(String file, int line) { lines.location(file, line); }
            public void emptyLocation() { lines.emptyLocation(); }
            public void start(MethodReference method) { depth[0]++; starts[0]++; lines.start(method); }
            public void end() { depth[0]--; lines.end(); }
        };
        new WasmBinaryRenderer(new WasmBinaryWriter(), WasmBinaryVersion.V_0x1, false,
                null, null, observed, null, WasmBinaryStatsCollector.EMPTY).render(module);
        if (depth[0] != 0 || starts[0] != 4) {
            throw new AssertionError("Unbalanced inline scopes: starts=" + starts[0] + ", depth=" + depth[0]);
        }
        var sections = new HashMap<String, byte[]>();
        for (var section : debug.build()) sections.put(section.getName(), section.getData());
        var parser = new LinesDeobfuscationParser();
        parser.pullSections(sections::get);
        var info = parser.getLineInfo();
        if (info.sequences().size() != 2 || !info.sequences().get(1).method().name().equals("second")) {
            throw new AssertionError("Later function lost its debug sequence");
        }
        var sequence = info.sequences().get(0);
        var frames = info.deobfuscateSingle(sequence.startAddress() + 2);
        if (frames == null || frames.length != 3 || !frames[0].method.name().equals("inner")) {
            throw new AssertionError("Nested inline source frames were lost: " + java.util.Arrays.toString(
                    frames == null ? null : java.util.Arrays.stream(frames).map(f -> f.method.name()).toArray()));
        }
        System.out.println("Balanced 4 inline/function scopes; both functions and nested frames retained");
    }
}
