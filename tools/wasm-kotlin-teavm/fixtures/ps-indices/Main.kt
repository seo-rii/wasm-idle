import java.util.ArrayList

fun main() {
    val n = readInt()
    val nums = IntArray(n)
    for (i in nums.indices) {
        nums[i] = readInt()
    }

    val weights = LongArray(n)
    for (i in weights.indices step 2) {
        weights[i] = nums[i].toLong() + 100000000000L
    }

    val values = ArrayList<Int>()
    for (i in nums.indices) {
        values.add(nums[i] + i)
    }

    val weighted = ArrayList<Pair<Int, Long>>()
    for (i in weights.indices) {
        weighted.add(Pair(i, weights[i]))
    }

    val word = readString()
    val chars = word.toCharArray()

    var sum = 0
    for (i in nums.indices) {
        sum += nums[i]
    }

    var listScore = 0
    for (i in values.indices) {
        listScore += values[i] * (i + 1)
    }

    var longScore = 0L
    for (i in weighted.indices) {
        longScore += weighted[i].second
    }

    var stringScore = 0
    for (i in word.indices) {
        stringScore += i
    }
    for (i in chars.indices) {
        stringScore += i
    }

    println("indices=$n sum=$sum list=$listScore long=$longScore string=$stringScore")
}
