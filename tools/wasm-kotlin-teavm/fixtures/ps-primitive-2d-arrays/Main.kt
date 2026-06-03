fun main() {
    val n = readInt()
    val m = readInt()
    val base = readLong()
    val x = readDouble()
    val word = readString()

    val longs = Array(n) { LongArray(m) }
    val doubles = Array(n) { DoubleArray(m) }
    val chars = Array(n) { CharArray(m) }
    val flags = Array(n) { BooleanArray(m) }

    longs[0][0] = base
    longs[1][2] = base + 5
    longs[0][1] = longs[1][2]
    longs[0][1] += 7

    doubles[0][0] = x
    doubles[1][1] = x + 2.5
    doubles[1][1] *= 2.0

    chars[0][0] = word[0]
    chars[1][2] = word[word.length - 1]

    flags[0][1] = true
    flags[1][0] = !flags[0][1]
    flags[1][1] = flags[0][1] && !flags[1][0]

    val longScore = longs[0][0] + longs[0][1] + longs[1][2]
    val doubleScore = doubles[0][0] + doubles[1][1]
    val boolScore = if (flags[1][1]) 10 else 1

    println("grid2=$longScore double=${doubleScore.toLong()} chars=${chars[0][0]}${chars[1][2]} bool=$boolScore size=${longs.size},${longs[0].size},${doubles[1].size},${chars[1].size},${flags[0].size}")
}
