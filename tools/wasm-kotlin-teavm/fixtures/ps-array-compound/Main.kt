fun main() {
    val nums = IntArray(3)
    for (i in 0 until nums.size) {
        nums[i] = readInt()
    }
    nums[0] += nums[1]
    nums[1] *= nums[2]
    nums[2] %= 4

    val longs = LongArray(1)
    longs[0] = readLong()
    longs[0] += nums[0]

    val doubles = DoubleArray(1)
    doubles[0] = readDouble()
    doubles[0] += nums[2]
    doubles[0] *= 2.0

    println("arr=${nums[0]},${nums[1]},${nums[2]} long=${longs[0]} double=${doubles[0]}")
}
