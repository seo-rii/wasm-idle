package com.intellij.util.diff;

import java.util.ArrayList;
import java.util.Objects;

public final class Diff {
    private Diff() {
    }

    public static Change buildChanges(Object[] oldItems, Object[] newItems) throws FilesTooBigForDiffException {
        var prefix = 0;
        while (prefix < oldItems.length && prefix < newItems.length
                && Objects.equals(oldItems[prefix], newItems[prefix])) {
            prefix++;
        }

        var oldEnd = oldItems.length;
        var newEnd = newItems.length;
        while (oldEnd > prefix && newEnd > prefix && Objects.equals(oldItems[oldEnd - 1], newItems[newEnd - 1])) {
            oldEnd--;
            newEnd--;
        }

        var deleted = oldEnd - prefix;
        var inserted = newEnd - prefix;
        if (deleted == 0 && inserted == 0) {
            return null;
        }
        return new Change(prefix, prefix, deleted, inserted, null);
    }

    public static String[] splitLines(CharSequence text) {
        var lines = new ArrayList<String>();
        var start = 0;
        for (var index = 0; index < text.length(); index++) {
            if (text.charAt(index) == '\n') {
                lines.add(text.subSequence(start, index).toString());
                start = index + 1;
            }
        }
        lines.add(text.subSequence(start, text.length()).toString());
        return lines.toArray(new String[0]);
    }

    public static int translateLine(Change change, int line) {
        var translatedDelta = 0;
        for (var current = change; current != null; current = current.link) {
            if (line < current.line0) {
                return line + translatedDelta;
            }
            if (line < current.line0 + current.deleted) {
                return -1;
            }
            translatedDelta += current.inserted - current.deleted;
        }
        return line + translatedDelta;
    }

    public static final class Change {
        public final int line0;
        public final int line1;
        public final int deleted;
        public final int inserted;
        public final Change link;

        public Change(int line0, int line1, int deleted, int inserted, Change link) {
            this.line0 = line0;
            this.line1 = line1;
            this.deleted = deleted;
            this.inserted = inserted;
            this.link = link;
        }
    }
}
