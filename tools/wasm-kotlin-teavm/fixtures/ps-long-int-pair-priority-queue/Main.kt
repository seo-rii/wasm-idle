import java.util.PriorityQueue

fun makeState(distance: Long, vertex: Int): Pair<Long, Int> {
    return Pair(distance, vertex)
}

fun pushState(queue: PriorityQueue<Pair<Long, Int>>, distance: Long, vertex: Int): Boolean {
    return queue.add(Pair(distance, vertex))
}

fun main() {
    val base = readLong()
    val delta = readInt()
    val queue = PriorityQueue<Pair<Long, Int>>()

    pushState(queue, base + delta, 3)
    queue.offer(makeState(base - delta, 2))
    queue.add(Pair(base - delta, 1))
    queue.add(Pair(-base, 9))
    val target = Pair(base + delta, -1)
    queue.add(target)

    val startSize = queue.size
    val peek = queue.peek()
    val hadIn = target in queue
    val removed = queue.remove(target)
    val missing = Pair(base + 999L, 0) !in queue
    val first = queue.poll()
    val second = queue.poll()
    val third = queue.poll()
    val fourth = queue.poll()

    println("longIntPq=$startSize peek=${peek.first},${peek.second} first=${first.first},${first.second} second=${second.first},${second.second} third=${third.first},${third.second} fourth=${fourth.first},${fourth.second} flags=$hadIn,$removed,$missing empty=${queue.isEmpty()} size=${queue.size}")
}
