fun main() {
    val n = readInt()
    val values = IntArray(n)
    var i = 0
    var weighted = 0
    while (i < n) {
        values[i] = readInt()
        weighted = weighted + values[i] * (i + 1)
        i = i + 1
    }

    val bonus = readLong()
    val total = bonus + weighted
    println("weighted=$weighted total=$total")
}
