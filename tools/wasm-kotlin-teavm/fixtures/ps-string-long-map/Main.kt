import java.util.HashMap

fun addDistance(dist: MutableMap<String, Long>, key: String, value: Long): Long {
    val next = dist.getOrDefault(key, 0L) + value
    dist[key] = next
    return next
}

fun main() {
    val firstKey = readString()
    val secondKey = readString()
    val base = readLong()
    val step = readLong()

    val builder = StringBuilder()
    builder.append(firstKey)
    builder.append(":")
    builder.append(secondKey)
    val joined = builder.toString()

    val dist = mutableMapOf<String, Long>()
    val first = addDistance(dist, firstKey, base)
    addDistance(dist, secondKey, step)
    val second = addDistance(dist, firstKey, step)
    dist.put(joined, dist[firstKey] + dist.getOrDefault(secondKey, 0L))

    val hadFirst = dist.containsKey(firstKey)
    val hadJoined = joined in dist
    val missing = "missing" !in dist
    val removed = dist.remove(secondKey)
    val fallback = dist.getOrDefault("missing", -11L)
    val value = dist.get(joined)

    val more = HashMap<String, Long>()
    more[firstKey.uppercase()] = removed + fallback
    more.put(joined, value)

    dist.clear()
    println("stringLongMap=${dist.size},${more.size} first=$first second=$second value=$value removed=$removed fallback=$fallback flags=$hadFirst,$hadJoined,$missing empty=${dist.isEmpty()},${more.isEmpty()} more=${more[firstKey.uppercase()]},${more.getOrDefault(joined, 0L)}")
}
