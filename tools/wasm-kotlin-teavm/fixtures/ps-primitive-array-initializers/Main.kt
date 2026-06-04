fun main() {
    val n = readInt()
    val ints = IntArray(n) { index -> readInt() + index }
    val longs = LongArray(n) { readLong() + it }
    val doubles = DoubleArray(2) { readDouble() + it }
    val word = readString()
    val chars = CharArray(n) { word[it] }
    val flags = BooleanArray(n) { it % 2 == 0 }

    var intSum = 0
    for (i in ints.indices) {
        intSum += ints[i]
    }

    var longSum = 0L
    for (i in longs.indices) {
        longSum += longs[i]
    }

    println("arrayInit=${ints[0]},${ints.last()},$intSum long=${longs[0]},${longs.last()},$longSum double=${doubles[0].toInt()},${doubles[1].toInt()} chars=${chars[0]}${chars.last()} flags=${flags[0]},${flags.last()}")
}
