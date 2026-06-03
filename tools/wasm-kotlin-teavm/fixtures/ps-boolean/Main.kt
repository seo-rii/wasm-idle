fun isEven(value: Int): Boolean {
    return value % 2 == 0
}

fun main() {
    val n = readInt()
    val seen = BooleanArray(n + 1)
    var i = 0
    while (i < n) {
        val value = readInt()
        if (value >= 0 && value <= n) {
            seen[value] = true
        }
        i = i + 1
    }

    var count = 0
    var hasTwo = false
    i = 0
    while (i <= n) {
        if (seen[i]) {
            count = count + 1
        }
        if (i == 2 && seen[i]) {
            hasTwo = true
        }
        i = i + 1
    }

    val ok = hasTwo && isEven(count) || !seen[0]
    println("bool=$ok count=$count two=$hasTwo")
}
