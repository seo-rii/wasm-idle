import java.util.ArrayDeque

fun main() {
    val base = readLong()
    val step = readLong()
    val deque = ArrayDeque<Pair<Long, Long>>()

    deque.add(Pair(base, base + step))
    deque.addFirst(Pair(base - step, base - step - step))
    deque.addLast(Pair(base + step, base + step + step))

    val peek = deque.peek()
    val first = deque.removeFirst()
    val last = deque.pollLast()
    deque.offer(Pair(first.first + last.first, first.second + last.second))
    deque.offerFirst(Pair(1L, 2L))
    deque.offerLast(Pair(3L, 4L))

    val has = Pair(3L, 4L) in deque
    val missing = Pair(9L, 9L) !in deque
    val head = deque.getFirst()
    val tail = deque.getLast()

    var score = 0L
    while (!deque.isEmpty()) {
        val (left, right) = deque.poll()
        score += left + right
    }

    println("longLongPairDeque=$score peek=${peek.first},${peek.second} first=${first.first},${first.second} last=${last.first},${last.second} edge=${head.first},${head.second}|${tail.first},${tail.second} flags=$has,$missing size=${deque.size}")
}
