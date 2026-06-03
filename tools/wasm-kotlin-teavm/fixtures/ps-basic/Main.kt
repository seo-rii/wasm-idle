fun gcd(a: Int, b: Int): Int {
    var x = a
    var y = b
    while (y != 0) {
        val r = x % y
        x = y
        y = r
    }
    return x
}

fun main() {
    val g = gcd(48, 18)
    var sum = 0
    var i = 1
    while (i <= 5) {
        if (i % 2 == 0) {
            sum = sum + i
        } else {
            sum = sum + 1
        }
        i = i + 1
    }
    println("gcd=$g sum=$sum")
}
