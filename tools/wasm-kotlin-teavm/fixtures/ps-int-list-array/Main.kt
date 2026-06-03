import java.util.ArrayList

fun addEdge(graph: Array<ArrayList<Int>>, a: Int, b: Int) {
    graph[a].add(b)
}

fun sumNeighbors(graph: Array<ArrayList<Int>>, node: Int): Int {
    var sum = 0
    repeat(graph[node].size) {
        sum += graph[node][it]
    }
    return sum
}

fun main() {
    val n = readInt()
    val m = readInt()
    val graph = Array(n) { ArrayList<Int>() }

    repeat(m) {
        val a = readInt()
        val b = readInt()
        addEdge(graph, a, b)
        addEdge(graph, b, a)
    }

    graph[0].add(0, n)
    val first = graph[0].first()
    graph[1].add(graph[0][1])
    val removed = graph[2].removeAt(0)
    graph[2].add(removed + graph[2].size)

    val replacement = mutableListOf<Int>()
    replacement.add(9)
    replacement.add(10)
    graph[n - 1] = replacement

    var total = 0
    repeat(n) {
        total += sumNeighbors(graph, it)
    }

    val had = 2 in graph[1]
    val missing = 3 !in graph[0]

    println("adj=${graph.size},${graph[0].size},${graph[n - 1].size} first=$first removed=$removed total=$total flags=$had,$missing tail=${graph[n - 1][0]},${graph[n - 1][1]}")
}
