fun main() {
    val base = readLong()
    val step = readInt()

    val nums = IntArray(3)
    nums[0] = step
    nums[1] = step + 1
    nums[2] = step + 2
    var intSum = 0
    for (value in nums) {
        intSum += value
    }

    val weights = LongArray(2)
    weights[0] = base
    weights[1] = base + step
    var longSum = 0L
    for (weight in weights) {
        longSum += weight
    }

    val word = "kotlin"
    var hits = 0
    for (ch in word) {
        if (ch == 'o') {
            hits += 1
        }
    }

    val values = ArrayList<Int>()
    values.add(step)
    values.add(step * 2)
    var listSum = 0
    for (value in values) {
        listSum += value
    }

    val words = ArrayList<String>()
    words.add("ab")
    words.add("cd")
    var textScore = 0
    for (text in words) {
        textScore += text.length
    }

    val weighted = ArrayList<Pair<Int, Long>>()
    weighted.add(Pair(1, base))
    weighted.add(Pair(2, base + step))
    var pairScore = 0L
    for ((to, weight) in weighted) {
        pairScore += weight + to
    }

    val states = ArrayList<Pair<Long, Int>>()
    states.add(Pair(base - step, 3))
    states.add(Pair(base + step, 4))
    var stateScore = 0L
    for ((distance, vertex) in states) {
        stateScore += distance + vertex
    }

    val graph = Array(2) { ArrayList<Pair<Int, Int>>() }
    graph[0].add(Pair(1, step))
    graph[0].add(Pair(2, step + 1))
    var graphScore = 0
    for ((to, cost) in graph[0]) {
        graphScore += to * 10 + cost
    }

    println("foreach=$intSum,$longSum,$hits,$listSum pair=$pairScore state=$stateScore graph=$graphScore text=$textScore")
}
