fun checksum(values: IntArray): Int {
    var i = 0
    var total = 0
    while (i < 5) {
        total = total + values[i] * (i + 1)
        i = i + 1
    }
    return total
}

fun score(values: LongArray, bonus: Long): Long {
    var i = 0
    var total = 0L
    while (i < 4) {
        total = total + values[i]
        i = i + 1
    }
    return total + bonus
}

fun main() {
    val ints = IntArray(5)
    ints[0] = 3
    ints[1] = 1
    ints[2] = 4
    ints[3] = 1
    ints[4] = 5

    val longs = LongArray(4)
    longs[0] = 10000000000L
    longs[1] = 20000000000L
    longs[2] = 30000000000L
    longs[3] = 40000000000L

    val chk = checksum(ints)
    val total = score(longs, 7L)
    println("chk=$chk total=$total")
}
