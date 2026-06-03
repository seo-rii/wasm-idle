fun main() {
    val a = IntArray(3)
    val b = LongArray(2)
    val c = DoubleArray(2)
    val d = CharArray(2)
    val e = BooleanArray(3)
    a.fill(7)
    b.fill(100000000000L)
    c.fill(1.5)
    d.fill('x')
    e.fill(true)
    a[1] += 1
    println("fill=${a[0]},${a[1]} long=${b[1]} double=${c[0] + c[1]} char=${d[0]}${d[1]} bool=${e[2]}")
}
