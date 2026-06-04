fun main() {
    val base = readLong()
    val step = readLong()

    val list = ArrayList<Pair<Long, Long>>()
    list.add(Pair(base, base + step))
    list.add(Pair(base + step, base + step + step))
    list.add(1, Pair(base - step, base - step - step))
    list[0] = Pair(list[0].first + step, list[0].second + step)

    val first = list.first()
    val last = list.last()
    val removed = list.removeAt(1)
    val has = Pair(base + step, base + step + step) in list
    val missing = Pair(1L, 2L) !in list

    val alt = mutableListOf<Pair<Long, Long>>()
    alt.add(Pair(1L, 2L))
    alt.add(Pair(3L, 4L))
    val removedAlt = alt.remove(Pair(1L, 2L))
    alt.clear()
    val empty = alt.isEmpty()

    val graph = Array(2) { ArrayList<Pair<Long, Long>>() }
    graph[0] = list
    graph[1].add(Pair(5L, 6L))
    graph[1].add(Pair(7L, 8L))

    var score = 0L
    for (i in graph.indices) {
        for ((left, right) in graph[i]) {
            score += left + right
        }
    }

    val head = graph[0][0]
    val tail = graph[0][graph[0].lastIndex]
    val edge = graph[1].removeAt(0)
    graph[1].reverse()
    val reversed = graph[1].first()

    println("longLongPairList=$score first=${first.first},${first.second} last=${last.first},${last.second} removed=${removed.first},${removed.second} head=${head.first},${head.second} tail=${tail.first},${tail.second} edge=${edge.first},${edge.second} rev=${reversed.first},${reversed.second} flags=$has,$missing,$removedAlt,$empty size=${list.size},${graph[1].size},${alt.size}")
}
