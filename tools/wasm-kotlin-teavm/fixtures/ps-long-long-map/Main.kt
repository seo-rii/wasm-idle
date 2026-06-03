import java.util.HashMap

fun main() {
    val a = readLong()
    val b = readLong()

    val scores = mutableMapOf<Long, Long>()
    scores[a] = a + b
    scores.put(b, a - b)
    scores[a + b] = scores[a] + scores.getOrDefault(b, 0L)

    val hadA = scores.containsKey(a)
    val hadSum = a + b in scores
    val missing = (a - b - b) !in scores
    val removed = scores.remove(b)
    val fallback = scores.getOrDefault(a - b - b, -9L)
    val value = scores.get(a + b)

    val more = HashMap<Long, Long>()
    more[a - b] = removed + fallback
    more.put(a + b, value)

    scores.clear()
    println("longLongMap=${scores.size},${more.size} value=$value removed=$removed fallback=$fallback flags=$hadA,$hadSum,$missing empty=${scores.isEmpty()},${more.isEmpty()} more=${more[a - b]},${more.getOrDefault(a + b, 0L)}")
}
