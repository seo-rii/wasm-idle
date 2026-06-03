package solve

import kotlin.math.*

fun gcd(a: Int, b: Int): Int {
    var x = a
    var y = b
    while (y != 0) {
        val next = x % y
        x = y
        y = next
    }
    return x
}

fun main() {
    val left = readInt()
    val right = readInt()
    println("pkg=${gcd(left, right)}")
}
