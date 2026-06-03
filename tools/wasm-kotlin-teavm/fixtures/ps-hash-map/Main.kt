import java.util.HashMap

fun main() {
    val n = readInt()
    val counts = HashMap<Int, Int>()
    repeat(n) {
        val value = readInt()
        counts[value] = counts.getOrDefault(value, 0) + 1
    }
    counts.put(100, counts.size)
    val hadTwo = counts.containsKey(2)
    val twoCount = counts[2]
    val removed = counts.remove(3)
    val after = counts.getOrDefault(3, -1)

    val extra = mutableMapOf<Int, Int>()
    extra[1] = counts.size
    counts.clear()

    println("map=$twoCount removed=$removed after=$after had=$hadTwo extra=${extra[1]} empty=${counts.isEmpty()} size=${counts.size}")
}
