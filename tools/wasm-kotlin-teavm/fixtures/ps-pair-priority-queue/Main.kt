import java.util.PriorityQueue

fun pushPair(queue: PriorityQueue<Pair<Int, Int>>, first: Int, second: Int): Boolean {
    return queue.add(Pair(first, second))
}

fun main() {
    val queue = PriorityQueue<Pair<Int, Int>>()
    pushPair(queue, 5, 1)
    queue.offer(Pair(3, 9))
    queue.add(Pair(3, 4))
    queue.add(Pair(-1, 8))
    queue.offer(Pair(5, -2))

    val hadIn = Pair(3, 4) in queue
    val hadDirect = queue.contains(Pair(3, 9))
    val removed = queue.remove(Pair(5, 1))
    val missing = Pair(5, 1) !in queue
    val startSize = queue.size

    val peek = queue.peek()
    val first = queue.poll()
    val second = queue.poll()
    queue.add(Pair(0, -10))
    val third = queue.poll()

    var score = 0
    while (!queue.isEmpty()) {
        val item = queue.poll()
        score += item.first * 100 + item.second
    }

    println("pairPq=$startSize peek=${peek.first},${peek.second} first=${first.first},${first.second} second=${second.first},${second.second} third=${third.first},${third.second} score=$score flags=$hadIn,$hadDirect,$removed,$missing empty=${queue.isEmpty()} size=${queue.size}")
}
