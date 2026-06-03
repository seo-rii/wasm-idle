import java.util.HashMap

fun main() {
    val key = readInt()
    val a = readLong()
    val b = readLong()

    val dist = mutableMapOf<Int, Long>()
    dist[key] = a
    dist.put(key + 1, b)
    dist[key + 2] = dist[key] + dist.getOrDefault(key + 1, 0L)

    val hadKey = key in dist
    val missing = (key + 3) !in dist
    val removed = dist.remove(key + 1)
    val fallback = dist.getOrDefault(key + 9, -5L)
    val value = dist.get(key + 2)

    val more = HashMap<Int, Long>()
    more[key] = removed + fallback
    more.put(key + 2, value)

    dist.clear()
    println("intLongMap=${dist.size},${more.size} value=$value removed=$removed fallback=$fallback flags=$hadKey,$missing empty=${dist.isEmpty()},${more.isEmpty()} more=${more[key]},${more.getOrDefault(key + 2, 0L)}")
}
