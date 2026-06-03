import java.util.PriorityQueue

fun main() {
    val n = readInt()
    val queue = PriorityQueue<Int>()
    repeat(n) {
        queue.add(readInt())
    }
    queue.offer(queue.peek() + 2)

    var weighted = 0
    var index = 1
    while (!queue.isEmpty()) {
        weighted += queue.poll() * index
        index++
    }
    println("pq=$weighted count=${index - 1} size=${queue.size}")
}
