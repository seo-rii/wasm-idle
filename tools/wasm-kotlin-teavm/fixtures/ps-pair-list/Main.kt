import java.util.ArrayList

fun makeEdge(a: Int, b: Int): Pair<Int, Int> {
    return Pair(a, b)
}

fun main() {
    val n = readInt()
    val edges = ArrayList<Pair<Int, Int>>()
    repeat(n) {
        val a = readInt()
        val b = readInt()
        edges.add(Pair(a, b))
    }

    edges.add(makeEdge(edges[0].second, edges[0].first))
    edges[1] = Pair(edges[1].first + 10, edges[1].second + 20)

    val probe = Pair(edges[0].first, edges[0].second)
    val had = probe in edges
    val removed = edges.remove(probe)
    val missing = Pair(1, 2) !in edges
    val present = edges.contains(Pair(2, 1))
    val extra = mutableListOf<Pair<Int, Int>>()
    extra.add(Pair(5, 6))

    var score = 0
    repeat(edges.size) {
        score += edges[it].first * 10 + edges[it].second
    }
    score += extra[0].first + extra[0].second
    val first = edges[0]
    val last = edges[edges.size - 1]

    println("pairs=${first.first},${first.second}|${last.first},${last.second} score=$score flags=$had,$removed,$missing,$present empty=${edges.isEmpty()} size=${edges.size}")
}
