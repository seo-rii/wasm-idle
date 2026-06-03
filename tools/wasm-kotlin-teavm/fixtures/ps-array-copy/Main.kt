fun main() {
    val n = readInt()
    val nums = IntArray(n)
    for (i in nums.indices) {
        nums[i] = readInt()
    }

    val ints = nums.copyOf()
    val padded = nums.copyOf(n + 2)
    val middle = nums.copyOfRange(1, n)

    val base = readLong()
    val longs = LongArray(3)
    longs[0] = base
    longs[1] = base + 7L
    longs[2] = base + 14L
    val longPart = longs.copyOfRange(1, 3)

    val start = readDouble()
    val doubles = DoubleArray(2)
    doubles[0] = start
    doubles[1] = start + 1.5
    val doubleCopy = doubles.copyOf(3)

    val word = readString()
    val chars = word.toCharArray().copyOfRange(1, word.lastIndex)

    val flags = BooleanArray(3)
    flags[0] = ints[0] < ints.last()
    flags[1] = middle[0] == middle.last()
    flags[2] = chars[0] == 'l'
    val flagCopy = flags.copyOf()

    println("arrayCopy=${ints[0]},${padded.size},${padded[n + 1]},${middle[0]},${middle.last()} long=${longPart[0]},${longPart[1]} double=${doubleCopy[0]},${doubleCopy[2]} char=${chars[0]},${chars.last()} flags=${flagCopy[0]},${flagCopy[1]},${flagCopy[2]}")
}
