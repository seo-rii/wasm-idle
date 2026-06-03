import java.util.ArrayList

fun main() {
    val n = readInt()
    val values = ArrayList<Int>()
    repeat(n) {
        values.add(readInt())
    }
    values.add(0)
    values[values.size - 1] = values[0] + values[1]
    values.sort()

    var sum = 0
    repeat(values.size) {
        sum += values[it]
    }
    println("list=${values[0]},${values[values.size - 1]} size=${values.size} sum=$sum empty=${values.isEmpty()}")
}
