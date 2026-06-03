fun main() {
    val n = readInt()
    val ints = IntArray(n)
    val intList = ArrayList<Int>()
    for (i in ints.indices) {
        val value = readInt()
        ints[i] = value
        intList.add(value)
    }

    val longs = LongArray(n)
    val longList = ArrayList<Long>()
    for (i in longs.indices) {
        val value = readLong()
        longs[i] = value
        longList.add(value)
    }

    val doubles = DoubleArray(n)
    for (i in doubles.indices) {
        doubles[i] = readDouble()
    }

    println("agg=${ints.sum()},${ints.minOrNull()},${ints.maxOrNull()} long=${longs.sum()},${longs.minOrNull()},${longs.maxOrNull()} double=${doubles.sum()},${doubles.minOrNull()},${doubles.maxOrNull()} list=${intList.sum()},${intList.minOrNull()},${intList.maxOrNull()} longList=${longList.sum()},${longList.minOrNull()},${longList.maxOrNull()}")
}
