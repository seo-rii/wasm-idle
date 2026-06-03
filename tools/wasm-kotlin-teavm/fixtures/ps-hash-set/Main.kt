import java.util.HashSet

fun main() {
    val n = readInt()
    val seen = HashSet<Int>()
    repeat(n) {
        val value = readInt()
        if (seen.add(value)) {
            seen.add(value + 10)
        }
    }
    val other = mutableSetOf<Int>()
    other.add(seen.size)

    val hadOne = seen.contains(1)
    val removed = seen.remove(11)
    val missing = seen.contains(11)
    other.add(seen.size)
    seen.clear()

    println("set=${other.size},${other.contains(6)} had=$hadOne removed=$removed missing=$missing empty=${seen.isEmpty()}")
}
