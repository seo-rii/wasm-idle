fun vowelScore(s: String): Int {
    var i = 0
    var total = 0
    while (i < s.length) {
        val ch = s[i]
        if (ch == 'a' || ch == 'e' || ch == 'i' || ch == 'o' || ch == 'u') {
            total = total + i + 1
        }
        i = i + 1
    }
    return total
}

fun main() {
    val first = readString()
    val second = readString()
    val score = vowelScore(first) + vowelScore(second)
    println("score=$score first=${first[0]} secondLast=${second[second.length - 1]}")
}
