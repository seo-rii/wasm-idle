fun shift(pair: Pair<Long, Long>, delta: Long): Pair<Long, Long> {
    return Pair(pair.first - delta, pair.second + delta)
}

fun main() {
    val base = readLong()
    val step = readLong()

    val pair = Pair(base, base + step)
    val (left, right) = pair
    val shifted = shift(Pair(left + step, right - step), step)
    val (a, b) = shifted
    val (_, tail) = Pair(a - step, b + step)
    val direct = Pair(-base, base + step + step)

    println("longPair=$left,$right shifted=$a,$b tail=$tail direct=${direct.first},${direct.second}")
}
