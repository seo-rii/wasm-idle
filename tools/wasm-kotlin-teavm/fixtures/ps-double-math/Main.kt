import kotlin.math.*

fun main() {
    val n = readInt()
    val offset = readLong()
    val x = readDouble()

    val root = sqrt(n.toDouble())
    val powered = pow(root, 3.0)
    val low = floor(x + 0.4).toInt()
    val high = ceil(x + 0.4).toLong()
    val mixed = (offset + root.toLong()).toDouble()

    println("math=${root.toInt()},${powered.toInt()} low=$low high=$high mix=${mixed.toLong()}")
}
