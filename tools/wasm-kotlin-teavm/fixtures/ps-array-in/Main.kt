fun main() {
    val ints = IntArray(3)
    ints[0] = 1
    ints[1] = 3
    ints[2] = 5

    val longs = LongArray(2)
    longs[0] = 100000000000L
    longs[1] = 7L

    val doubles = DoubleArray(2)
    doubles[0] = 1.5
    doubles[1] = 2.5

    val chars = readString().toCharArray()
    val flags = BooleanArray(2)
    flags[0] = true
    flags[1] = false

    val direct = 3 in ints
    val directNot = 4 !in ints

    var score = 0
    if (direct) score += 1
    if (directNot) score += 2
    if (100000000000L in longs) score += 4
    if (8L !in longs) score += 8
    if (2.5 in doubles) score += 16
    if (3.5 !in doubles) score += 32
    if ('a' in chars) score += 64
    if ('z' !in chars) score += 128
    if (true in flags) score += 256
    if (false in flags) score += 512

    println("arrayIn=$score size=${ints.size},${chars.size}")
}
