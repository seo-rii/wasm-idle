fun makeState(distance: Long, vertex: Int): Pair<Long, Int> {
    return Pair(distance, vertex)
}

fun totalDistance(states: ArrayList<Pair<Long, Int>>): Long {
    var total = 0L
    for (i in states.indices) {
        total += states[i].first
    }
    return total
}

fun main() {
    val base = readLong()
    val step = readInt()

    val states = ArrayList<Pair<Long, Int>>()
    states.add(makeState(base, 2))
    states.add(Pair(base - step, 1))
    states.add(1, Pair(-base, 9))

    val extra = mutableListOf<Pair<Long, Int>>()
    extra.add(Pair(base + step, 3))
    extra.add(Pair(base + step + 1L, 4))

    val graph = Array(2) { ArrayList<Pair<Long, Int>>() }
    graph[0].add(states[0])
    graph[0].add(extra.last())
    graph[1] = extra

    val first = states.first()
    val last = states.last()
    val removedAt = states.removeAt(1)
    val had = Pair(base, 2) in states
    val removed = states.remove(Pair(base - step, 1))
    val missing = Pair(7L, 7) !in states
    val graphScore = graph[0][0].first + graph[0][1].second + graph[1][0].first

    println("longIntPairs=${first.first},${first.second}|${last.first},${last.second} removed=${removedAt.first},${removedAt.second} flags=$had,$removed,$missing graph=$graphScore total=${totalDistance(states)} empty=${states.isEmpty()} size=${states.size},${extra.size}")
}
