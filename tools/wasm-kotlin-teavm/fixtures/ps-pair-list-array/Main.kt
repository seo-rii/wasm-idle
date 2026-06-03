import java.util.ArrayList

fun addWeightedEdge(graph: Array<ArrayList<Pair<Int, Int>>>, a: Int, b: Int, weight: Int) {
    graph[a].add(Pair(b, weight))
}

fun scoreEdges(graph: Array<ArrayList<Pair<Int, Int>>>, node: Int): Int {
    var score = 0
    repeat(graph[node].size) {
        val edge = graph[node][it]
        score += edge.first * 10 + edge.second
    }
    return score
}

fun main() {
    val n = readInt()
    val m = readInt()
    val graph = Array(n) { ArrayList<Pair<Int, Int>>() }

    repeat(m) {
        val a = readInt()
        val b = readInt()
        val weight = readInt()
        addWeightedEdge(graph, a, b, weight)
        addWeightedEdge(graph, b, a, weight + 1)
    }

    graph[0].add(0, Pair(n, 1))
    val first = graph[0].first()
    graph[1].add(Pair(graph[0][1].first, graph[0][1].second + 3))
    val removed = graph[2].removeAt(0)
    graph[2].add(Pair(removed.first + graph[2].size, removed.second))

    val replacement = mutableListOf<Pair<Int, Int>>()
    replacement.add(Pair(9, 10))
    replacement.add(Pair(11, 12))
    graph[n - 1] = replacement

    var total = 0
    repeat(n) {
        total += scoreEdges(graph, it)
    }

    val had = Pair(2, 7) in graph[1]
    val missing = Pair(3, 11) !in graph[0]
    val tailFirst = graph[n - 1][0]
    val tailLast = graph[n - 1][1]

    println("weighted=${graph.size},${graph[0].size},${graph[n - 1].size} first=${first.first},${first.second} removed=${removed.first},${removed.second} total=$total flags=$had,$missing tail=${tailFirst.first},${tailFirst.second}|${tailLast.first},${tailLast.second}")
}
