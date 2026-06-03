import java.util.ArrayList

fun pushWord(words: MutableList<String>, value: String): Int {
    words.add(value)
    words.add(0, value.uppercase())
    return words.size
}

fun main() {
    val first = readString()
    val second = readString()

    val words = mutableListOf<String>()
    val count = pushWord(words, first)
    words.add(second)
    words.add(words.size, second.uppercase())
    words[1] = second.lowercase()

    val firstValue = words.first()
    val lastValue = words.last()
    val hadSecond = second in words
    val missing = "missing" !in words
    val removedAt = words.removeAt(1)
    val removedUpper = words.remove(first.uppercase())
    words.sort()
    val sortedFirst = words[0]
    val sortedLast = words.last()

    val extra = ArrayList<String>()
    extra.add(first)
    extra.add(0, second)
    extra[1] = first.uppercase()

    words.clear()
    println("stringList=${words.size},${extra.size} count=$count first=$firstValue last=$lastValue removed=$removedAt,$removedUpper sorted=$sortedFirst,$sortedLast flags=$hadSecond,$missing empty=${words.isEmpty()} extra=${extra.first()},${extra[1]}")
}
