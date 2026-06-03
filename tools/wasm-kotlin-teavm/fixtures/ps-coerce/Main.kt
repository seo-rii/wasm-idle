fun clampDistance(value: Long): Long {
    return value.coerceAtLeast(100000000000L).coerceAtMost(100000000010L)
}

fun main() {
    val x = readInt()
    val y = readLong()
    val z = readDouble()

    val low = x.coerceAtLeast(0)
    val high = x.coerceAtMost(10)
    val bounded = x.coerceIn(2, 8)
    val distance = clampDistance(y)
    val shifted = (y - 20L).coerceIn(99999999990L, 100000000005L)
    val ratio = z.coerceAtLeast(1.5).coerceAtMost(4.5)
    val narrow = z.coerceIn(2.0, 3.0)

    println("coerce=$low,$high,$bounded long=$distance,$shifted double=$ratio,$narrow")
}
