package org.teavm.dependency;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.teavm.model.ClassHierarchy;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassReader;
import org.teavm.model.ElementModifier;
import org.teavm.model.ListableClassReaderSource;
import org.teavm.model.classes.TagRegistry;

/** JVM-only regression checks; never included in javacs or its Wasm output. */
public final class DeterminismTest {
    public static void main(String[] args) {
        if (args.length == 0 || args[0].equals("domains")) verifyDomainOrder();
        if (args.length == 0 || args[0].equals("tags")) verifyClassTags();
        System.out.println("TeaVM dependency-domain and class-tag determinism verified");
    }

    private static DependencyNode node(int hash) {
        // Keep object identity equality but force the bucket order to differ from insertion order.
        var node = new DependencyNode(null, null) {
            @Override public int hashCode() { return hash; }
        };
        node.followers = List.of(type -> {});
        return node;
    }

    private static void verifyDomainOrder() {
        var first = node(3);
        var second = node(2);
        var third = node(1);
        var expected = List.of(first, second, third);
        var single = new TypeSet(null, first);
        single.addDomain(second);
        single.addDomain(third);
        var batch = new TypeSet(null, first);
        batch.addDomain(List.of(second, third));
        for (var domain : List.of(single, batch)) {
            require(new ArrayList<>(domain.domain()).equals(expected), "dependency domain reordered");
            var consumers = domain.getConsumers();
            for (int i = 0; i < expected.size(); i++) {
                require(consumers.get(i).node == expected.get(i), "consumer propagation reordered");
            }
            domain.removeDomain(List.of(first, second));
            domain.addDomain(first);
            require(new ArrayList<>(domain.domain()).equals(List.of(third, first)),
                    "collapsed domain lost insertion order");
        }
    }

    private static void verifyClassTags() {
        var classes = new LinkedHashMap<String, ClassHolder>();
        add(classes, "java.lang.Object", null, false);
        add(classes, "Shape", null, true);
        add(classes, "Colored", null, true, "Shape");
        add(classes, "Circle", "java.lang.Object", false, "Shape");
        add(classes, "Square", "java.lang.Object", false, "Shape");
        add(classes, "RedCircle", "Circle", false, "Colored");
        add(classes, "Other", "java.lang.Object", false);
        var names = new ArrayList<>(classes.keySet());
        Map<String, List<String>> reference = null;
        for (int seed = 0; seed < 64; seed++) {
            Collections.shuffle(names, new Random(seed));
            var source = new ListableClassReaderSource() {
                @Override public Set<String> getClassNames() { return new LinkedHashSet<>(names); }
                @Override public ClassReader get(String name) { return classes.get(name); }
            };
            var hierarchy = new ClassHierarchy(source);
            var registry = new TagRegistry(source, hierarchy);
            var actual = new LinkedHashMap<String, List<String>>();
            for (var name : classes.keySet()) {
                actual.put(name, registry.getRanges(name).stream()
                        .map(range -> range.lower + ":" + range.upper).toList());
                // Sorting must preserve instanceof/isAssignableFrom semantics for classes and interfaces.
                for (var candidate : classes.values()) {
                    if (candidate.hasModifier(ElementModifier.INTERFACE)) continue;
                    int tag = registry.getRanges(candidate.getName()).get(0).lower;
                    boolean member = registry.getRanges(name).stream()
                            .anyMatch(range -> range.lower <= tag && tag < range.upper);
                    require(member == hierarchy.isSuperType(name, candidate.getName(), false),
                            "class-tag semantics differ: " + name + " / " + candidate.getName());
                }
            }
            if (reference == null) reference = actual;
            require(reference.equals(actual), "class tags depend on discovery order (seed " + seed + ")");
        }
    }

    private static void add(Map<String, ClassHolder> classes, String name, String parent,
            boolean isInterface, String... interfaces) {
        var cls = new ClassHolder(name);
        cls.setParent(parent);
        if (isInterface) cls.getModifiers().add(ElementModifier.INTERFACE);
        cls.getInterfaces().addAll(List.of(interfaces));
        classes.put(name, cls);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
