fun main() {
    var i = 0
    var total = 0
    while (i < 10) {
        i++
        if (i == 3) continue
        if (i == 8) break
        total += i
    }
    for (j in 0 until 6) {
        if (j == 1) continue
        if (j == 5) break
        total += j
    }
    println("flow=$total i=$i")
}
