import java.util.ArrayList

fun makeWeighted(to: Int, weight: Long): Pair<Int, Long> {
    return Pair(to, weight)
}

fun totalWeight(edges: ArrayList<Pair<Int, Long>>): Long {
    var total = 0L
    repeat(edges.size) {
        total += edges[it].second
    }
    return total
}

fun main() {
    val base = readLong()
    val step = readLong()

    val edges = ArrayList<Pair<Int, Long>>()
    edges.add(Pair(3, base))
    edges.add(makeWeighted(1, step))
    edges.add(1, Pair(2, base + step))
    edges[0] = Pair(edges[0].first + 10, edges[0].second + step)

    val probe = Pair(2, base + step)
    val had = probe in edges
    val removed = edges.remove(probe)
    val missing = Pair(9, 9L) !in edges
    val present = edges.contains(Pair(1, step))
    val removedAt = edges.removeAt(0)

    val extra = mutableListOf<Pair<Int, Long>>()
    extra.add(Pair(5, base - step))
    extra.add(makeWeighted(6, totalWeight(edges) + extra[0].second))

    val first = edges.first()
    val last = extra.last()
    val graph = Array(2) { ArrayList<Pair<Int, Long>>() }
    graph[0].add(first)
    graph[1] = extra
    val graphScore = graph[0][0].second + graph[1].last().second
    edges.clear()

    println("intLongPairs=${first.first},${first.second}|${last.first},${last.second} removed=${removedAt.first},${removedAt.second} flags=$had,$removed,$missing,$present graph=$graphScore empty=${edges.isEmpty()} size=${edges.size},${extra.size}")
}
