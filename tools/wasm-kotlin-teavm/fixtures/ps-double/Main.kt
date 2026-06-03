fun half(value: Double): Double {
    return value * 0.5
}

fun main() {
    val n = readInt()
    val values = DoubleArray(n)
    var i = 0
    while (i < n) {
        values[i] = readDouble()
        i++
    }

    var total = 0.0
    i = 0
    while (i < n) {
        total += half(values[i])
        i++
    }

    if (total > 3.0) {
        println("double=$total first=${values[0]}")
    } else {
        println("double=small first=${values[0]}")
    }
}
