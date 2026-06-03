import kotlin.math.*

fun main() {
    val a = readInt()
    val b = readInt()
    val c = readLong()
    val d = readDouble()
    val x = maxOf(abs(a - b), minOf(a, b))
    val y = maxOf(c, 100000000000L)
    val z = minOf(abs(d), 2.5)
    println("math=$x long=$y double=$z")
}
