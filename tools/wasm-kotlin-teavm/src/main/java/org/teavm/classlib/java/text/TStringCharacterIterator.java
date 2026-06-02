package org.teavm.classlib.java.text;

public final class TStringCharacterIterator implements TCharacterIterator {
    private String text;
    private int begin;
    private int end;
    private int pos;

    public TStringCharacterIterator(String text) {
        this(text, 0);
    }

    public TStringCharacterIterator(String text, int pos) {
        this(text, 0, text.length(), pos);
    }

    public TStringCharacterIterator(String text, int begin, int end, int pos) {
        if (text == null) {
            throw new NullPointerException();
        }
        if (begin < 0 || begin > end || end > text.length() || pos < begin || pos > end) {
            throw new IllegalArgumentException();
        }
        this.text = text;
        this.begin = begin;
        this.end = end;
        this.pos = pos;
    }

    public void setText(String text) {
        if (text == null) {
            throw new NullPointerException();
        }
        this.text = text;
        begin = 0;
        end = text.length();
        pos = 0;
    }

    @Override
    public char first() {
        pos = begin;
        return current();
    }

    @Override
    public char last() {
        pos = end == begin ? end : end - 1;
        return current();
    }

    @Override
    public char setIndex(int position) {
        if (position < begin || position > end) {
            throw new IllegalArgumentException();
        }
        pos = position;
        return current();
    }

    @Override
    public char current() {
        return pos >= begin && pos < end ? text.charAt(pos) : DONE;
    }

    @Override
    public char next() {
        if (pos < end - 1) {
            pos++;
            return current();
        }
        pos = end;
        return DONE;
    }

    @Override
    public char previous() {
        if (pos > begin) {
            pos--;
            return current();
        }
        return DONE;
    }

    @Override
    public int getBeginIndex() {
        return begin;
    }

    @Override
    public int getEndIndex() {
        return end;
    }

    @Override
    public int getIndex() {
        return pos;
    }

    @Override
    public boolean equals(Object other) {
        if (!(other instanceof TStringCharacterIterator)) {
            return false;
        }
        var that = (TStringCharacterIterator) other;
        return text.equals(that.text) && begin == that.begin && end == that.end && pos == that.pos;
    }

    @Override
    public int hashCode() {
        return text.hashCode() ^ begin ^ end ^ pos;
    }

    @Override
    public Object clone() {
        return new TStringCharacterIterator(text, begin, end, pos);
    }
}
