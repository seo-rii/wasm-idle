fun bucket(x: Int): Int {
    var score = 0
    when (x) {
        0 -> score = 10
        1, 2 -> score = 20
        else -> score = 30
    }
    val extra = when {
        x < 0 -> -1
        x == 0 -> 0
        else -> x + 1
    }
    return score + extra
}

fun main() {
    val a = readInt()
    val b = readInt()
    println("when=${bucket(a)} ${bucket(b)}")
}
