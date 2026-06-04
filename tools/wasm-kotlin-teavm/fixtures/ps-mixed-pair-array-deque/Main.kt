import java.util.ArrayDeque

fun main() {
    val base = readLong()
    val step = readInt()

    val weighted = ArrayDeque<Pair<Int, Long>>()
    weighted.add(Pair(step, base))
    weighted.addLast(Pair(step + 1, base + step))
    weighted.addFirst(Pair(step - 1, base - step))
    val weightedPeek = weighted.peek()
    val weightedFirst = weighted.removeFirst()
    val weightedLast = weighted.pollLast()
    weighted.offer(Pair(weightedFirst.first + weightedLast.first, weightedFirst.second + weightedLast.second))
    weighted.offerFirst(Pair(1, 2L))
    weighted.offerLast(Pair(3, 4L))
    val weightedHas = Pair(3, 4L) in weighted
    val weightedMissing = Pair(9, 9L) !in weighted
    val weightedHead = weighted.first()
    val weightedTail = weighted.last()

    var weightedScore = 0L
    while (!weighted.isEmpty()) {
        val (to, cost) = weighted.poll()
        weightedScore += cost + to
    }

    val states = ArrayDeque<Pair<Long, Int>>()
    states.add(Pair(base, step))
    states.addLast(Pair(base + step, step + 1))
    states.addFirst(Pair(base - step, step - 1))
    val statePeek = states.peekFirst()
    val stateFirst = states.removeFirst()
    val stateLast = states.pollLast()
    states.offer(Pair(stateFirst.first + stateLast.first, stateFirst.second + stateLast.second))
    states.offerFirst(Pair(5L, 6))
    states.offerLast(Pair(7L, 8))
    val stateHas = Pair(7L, 8) in states
    val stateMissing = Pair(11L, 12) !in states
    val stateHead = states.getFirst()
    val stateTail = states.getLast()

    var stateScore = 0L
    while (!states.isEmpty()) {
        val (distance, node) = states.poll()
        stateScore += distance + node
    }

    println("mixedPairDeque=$weightedScore,$stateScore weighted=${weightedPeek.first},${weightedPeek.second}|${weightedHead.first},${weightedHead.second}|${weightedTail.first},${weightedTail.second} state=${statePeek.first},${statePeek.second}|${stateHead.first},${stateHead.second}|${stateTail.first},${stateTail.second} flags=$weightedHas,$weightedMissing,$stateHas,$stateMissing size=${weighted.size},${states.size}")
}
