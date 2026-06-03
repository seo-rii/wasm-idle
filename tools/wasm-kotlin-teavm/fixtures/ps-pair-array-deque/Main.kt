import java.util.ArrayDeque

fun main() {
    val start = readInt()
    val queue = ArrayDeque<Pair<Int, Int>>()

    queue.add(Pair(start, start + 1))
    queue.addLast(Pair(start + 2, start + 3))
    queue.addFirst(Pair(start - 1, start))

    val peek = queue.peek()
    val first = queue.removeFirst()
    val last = queue.pollLast()
    queue.offer(Pair(first.first + last.first, first.second + last.second))
    queue.offerFirst(Pair(9, 1))
    queue.offerLast(Pair(2, 8))

    val contains = Pair(2, 8) in queue
    val missing = Pair(7, 7) !in queue
    val head = queue.first()
    val tail = queue.last()

    var score = 0
    while (!queue.isEmpty()) {
        val (row, col) = queue.poll()
        score += row * 10 + col
    }

    println("pairDeque=$score peek=${peek.first},${peek.second} first=${first.first},${first.second} last=${last.first},${last.second} edge=${head.first},${head.second}|${tail.first},${tail.second} flags=$contains,$missing size=${queue.size}")
}
