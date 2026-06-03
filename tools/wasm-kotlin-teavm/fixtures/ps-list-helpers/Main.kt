import java.util.ArrayList

fun main() {
    val firstInput = readInt()
    val lastInput = readInt()

    val nums = mutableListOf<Int>()
    nums.add(3)
    nums.add(0, firstInput)
    nums.add(nums.size, lastInput)
    val firstNum = nums.first()
    val lastNum = nums.last()
    val removedNum = nums.removeAt(1)
    nums.clear()

    val pairs = ArrayList<Pair<Int, Int>>()
    pairs.add(Pair(1, 2))
    pairs.add(0, Pair(3, 4))
    pairs.add(pairs.size, Pair(5, 6))
    val firstPair = pairs.first()
    val lastPair = pairs.last()
    val removedPair = pairs.removeAt(1)
    pairs.clear()

    println("list=$firstNum,$lastNum removed=$removedNum pair=${firstPair.first},${firstPair.second}|${lastPair.first},${lastPair.second} removedPair=${removedPair.first},${removedPair.second} empty=${nums.isEmpty()},${pairs.isEmpty()} size=${nums.size},${pairs.size}")
}
