fun main() {
    val n = readInt()
    val a = IntArray(n)
    val b = LongArray(n)
    repeat(n) {
        a[it] = readInt()
        b[it] = readLong()
    }
    a.sort()
    b.sort()
    val chars = readString().toCharArray()
    chars.sort()
    println("sort=${a[0]},${a[n - 1]} long=${b[0]},${b[n - 1]} chars=${chars[0]}${chars[chars.size - 1]}")
}
