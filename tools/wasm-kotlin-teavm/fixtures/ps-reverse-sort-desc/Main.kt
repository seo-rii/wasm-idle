fun main() {
    val n = readInt()
    val ints = IntArray(n)
    val longs = LongArray(n)
    val doubles = DoubleArray(n)
    val chars = readString().toCharArray()
    val flags = BooleanArray(n)
    val intList = ArrayList<Int>()
    val longList = ArrayList<Long>()
    val stringList = ArrayList<String>()

    for (i in ints.indices) {
        val value = readInt()
        ints[i] = value
        intList.add(value)
    }
    for (i in longs.indices) {
        val value = readLong()
        longs[i] = value
        longList.add(value)
    }
    for (i in doubles.indices) {
        doubles[i] = readDouble()
        flags[i] = i % 2 == 0
    }
    for (i in 0 until n) {
        stringList.add(readString())
    }

    ints.sortDescending()
    longs.sortDescending()
    doubles.sortDescending()
    chars.sortDescending()
    flags.reverse()
    intList.sortDescending()
    longList.sortDescending()
    stringList.sortDescending()

    println("desc=${ints[0]},${ints.last()} long=${longs[0]},${longs.last()} double=${doubles[0]},${doubles.last()} chars=${chars[0]}${chars.last()} flags=${flags[0]},${flags.last()} list=${intList[0]},${intList.last()} longList=${longList[0]},${longList.last()} strings=${stringList[0]},${stringList.last()}")
}
