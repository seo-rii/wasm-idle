fun makePair(a: Int, b: Int): Pair<Int, Int> {
    return Pair(a + b, a * b)
}

fun main() {
    val first = readInt()
    val second = readInt()
    val base = Pair(first, second)
    val combined = makePair(base.first + 1, base.second + 2)
    val flipped = Pair(combined.second, combined.first)

    println("pair=${base.first},${base.second} combined=${combined.first},${combined.second} diff=${flipped.first - flipped.second}")
}
