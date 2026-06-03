import java.util.HashSet

fun main() {
    val a = readLong()
    val b = readLong()

    val seen = mutableSetOf<Long>()
    seen.add(a)
    seen.add(b)
    seen.add(a + b)

    val hadA = seen.contains(a)
    val hadB = b in seen
    val missing = (a - b) !in seen
    val removed = seen.remove(a + b)
    val removedAgain = seen.remove(a + b)

    val more = HashSet<Long>()
    more.add(a - b)
    more.add(a + b)
    val moreHad = (a - b) in more

    seen.clear()
    println("longSet=${seen.size},${more.size} flags=$hadA,$hadB,$missing,$removed,$removedAgain,$moreHad empty=${seen.isEmpty()},${more.isEmpty()}")
}
