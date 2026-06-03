fun main() {
    val n = readInt()
    var weighted = 0
    repeat(n) { index ->
        val value = readInt()
        weighted += value * (index + 1)
    }
    var implicit = 0
    repeat(3) {
        implicit += it
    }
    println("repeat=$weighted implicit=$implicit")
}
