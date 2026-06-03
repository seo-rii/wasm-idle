import java.util.HashSet

fun addBoth(target: MutableSet<String>, first: String, second: String): Int {
    val addedFirst = target.add(first)
    val addedSecond = target.add(second)
    return if (addedFirst && addedSecond) target.size else -1
}

fun main() {
    val first = readString()
    val second = readString()

    val builder = StringBuilder()
    builder.append(first)
    builder.append(second)
    val joined = builder.toString()

    val seen = mutableSetOf<String>()
    val count = addBoth(seen, first, second)
    seen.add(joined)

    val hadFirst = seen.contains(first)
    val hadSecond = second in seen
    val missing = "missing" !in seen
    val removed = seen.remove(joined)
    val removedAgain = seen.remove(joined)

    val more = HashSet<String>()
    more.add(first.uppercase())
    more.add(second.lowercase())
    val moreHad = first.uppercase() in more

    seen.clear()
    println("stringSet=${seen.size},${more.size} count=$count flags=$hadFirst,$hadSecond,$missing,$removed,$removedAgain,$moreHad empty=${seen.isEmpty()},${more.isEmpty()}")
}
