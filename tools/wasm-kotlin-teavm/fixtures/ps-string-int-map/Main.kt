import java.util.HashMap

fun increment(counts: MutableMap<String, Int>, key: String): Int {
    val next = counts.getOrDefault(key, 0) + 1
    counts[key] = next
    return next
}

fun main() {
    val firstKey = readString()
    val secondKey = readString()

    val builder = StringBuilder()
    builder.append(firstKey)
    builder.append(":")
    builder.append(secondKey)
    val joined = builder.toString()

    val counts = mutableMapOf<String, Int>()
    val first = increment(counts, firstKey)
    increment(counts, secondKey)
    val second = increment(counts, firstKey)
    counts.put(joined, counts[firstKey] + counts.getOrDefault(secondKey, 0))

    val hadFirst = counts.containsKey(firstKey)
    val hadJoined = joined in counts
    val missing = "missing" !in counts
    val removed = counts.remove(secondKey)
    val fallback = counts.getOrDefault("missing", -7)
    val value = counts.get(joined)

    val more = HashMap<String, Int>()
    more[firstKey.uppercase()] = removed + fallback
    more.put(joined, value)

    counts.clear()
    println("stringMap=${counts.size},${more.size} first=$first second=$second value=$value removed=$removed fallback=$fallback flags=$hadFirst,$hadJoined,$missing empty=${counts.isEmpty()},${more.isEmpty()} more=${more[firstKey.uppercase()]},${more.getOrDefault(joined, 0)}")
}
