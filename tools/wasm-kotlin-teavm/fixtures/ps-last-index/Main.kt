import java.util.ArrayList

fun main() {
    val n = readInt()
    val nums = IntArray(n)
    for (i in nums.indices) {
        nums[i] = readInt()
    }

    var reversed = 0
    for (i in nums.lastIndex downTo 0) {
        reversed = reversed * 10 + nums[i]
    }

    val word = readString()
    val chars = word.toCharArray()

    val values = ArrayList<Int>()
    val weighted = ArrayList<Pair<Int, Long>>()
    for (i in nums.indices) {
        values.add(nums[i] + i)
        weighted.add(Pair(i, nums[i].toLong()))
    }

    val score = nums.lastIndex + word.lastIndex + chars.lastIndex + values.lastIndex + weighted.lastIndex
    println("lastIndex=$reversed score=$score")
}
