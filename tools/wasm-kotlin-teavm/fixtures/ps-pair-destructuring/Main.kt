import java.util.PriorityQueue

fun main() {
    val base = readLong()
    val step = readInt()

    val intPair = Pair(step, step + 2)
    val (a, b) = intPair

    val intLongPair = Pair(step + 1, base + step)
    val (to, weight) = intLongPair

    val queue = PriorityQueue<Pair<Long, Int>>()
    queue.add(Pair(base - step, 2))
    queue.add(Pair(-base, 9))
    val (dist, node) = queue.poll()

    val states = ArrayList<Pair<Long, Int>>()
    states.add(Pair(base + step, 3))
    val (_, tail) = states[0]

    val graph = Array(1) { ArrayList<Pair<Int, Long>>() }
    graph[0].add(Pair(a + b, weight + tail))
    val (next, score) = graph[0][0]

    println("destructure=$a,$b|$to,$weight|$dist,$node tail=$tail graph=$next,$score")
}
