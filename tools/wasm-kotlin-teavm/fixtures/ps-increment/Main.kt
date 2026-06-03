fun main() {
    val n = readInt()
    val values = IntArray(n)
    var i = 0
    while (i < n) {
        values[i] = readInt()
        i++
    }

    var sum = 0
    var j = 0
    while (j < n) {
        sum += values[j++]
    }

    var k = n
    while (k > 0) {
        --k
        sum += k
    }

    println("inc=$sum last=${values[n - 1]}")
}
