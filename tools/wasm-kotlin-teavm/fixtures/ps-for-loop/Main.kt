fun main() {
    val n = readInt()
    val values = IntArray(n)
    for (i in 0 until n) {
        values[i] = readInt()
    }

    var sum = 0
    for (i in 0..(n - 1)) {
        sum += values[i]
    }

    var rev = 0
    for (i in (n - 1) downTo 0 step 2) {
        rev += values[i]
    }

    println("for=$sum rev=$rev last=${values[n - 1]}")
}
