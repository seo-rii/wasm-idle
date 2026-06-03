import java.util.HashMap

fun main() {
    val a = readLong()
    val b = readLong()

    val scores = mutableMapOf<Long, Int>()
    scores[a] = 1
    scores.put(b, 2)
    scores[a + b] = scores[a] + scores.getOrDefault(b, 0)

    val hadA = scores.containsKey(a)
    val hadSum = a + b in scores
    val missing = (a - b) !in scores
    val removed = scores.remove(b)
    val fallback = scores.getOrDefault(a - b, -7)
    val value = scores.get(a + b)

    val more = HashMap<Long, Int>()
    more[a - b] = removed + fallback
    more.put(a + b, value)

    scores.clear()
    println("longMap=${scores.size},${more.size} value=$value removed=$removed fallback=$fallback flags=$hadA,$hadSum,$missing empty=${scores.isEmpty()},${more.isEmpty()} more=${more[a - b]},${more.getOrDefault(a + b, 0)}")
}
