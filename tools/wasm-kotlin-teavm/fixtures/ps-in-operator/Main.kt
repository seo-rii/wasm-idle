import java.util.ArrayDeque
import java.util.ArrayList
import java.util.HashMap
import java.util.HashSet
import java.util.PriorityQueue

fun main() {
    val n = readInt()
    val set = HashSet<Int>()
    val list = ArrayList<Int>()
    val map = HashMap<Int, Int>()
    val queue = PriorityQueue<Int>()
    val deque = ArrayDeque<Int>()
    repeat(n) {
        val value = readInt()
        set.add(value)
        list.add(value)
        map[value] = value + 10
        queue.add(value)
        deque.add(value)
    }
    val word = readString()
    val direct = 2 in list
    val directNot = 9 !in set

    var score = 0
    if (3 in set) score += 1
    if (4 !in set) score += 2
    if (2 in list) score += 4
    if (5 !in list) score += 8
    if (1 in map) score += 16
    if (6 !in map) score += 32
    if (1 in 0 until n) score += 64
    if (n !in 0 until n) score += 128
    if (3 in 1..3) score += 256
    if (0 !in 1..3) score += 512
    if ('a' in word) score += 1024
    if ("go" in word) score += 2048
    if ('z' !in word) score += 4096
    if (queue.peek() in queue) score += 8192
    if (deque.first() in deque) score += 16384
    if (direct) score += 32768
    if (directNot) score += 65536

    println("in=$score size=${set.size},${map.size}")
}
