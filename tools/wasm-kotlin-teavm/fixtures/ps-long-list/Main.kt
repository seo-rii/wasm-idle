import java.util.ArrayList

fun main() {
    val a = readLong()
    val b = readLong()

    val values = mutableListOf<Long>()
    values.add(a)
    values.add(0, b)
    values.add(values.size, a + b)

    val first = values.first()
    val last = values.last()
    val removedAt = values.removeAt(1)
    val hadB = b in values
    val missingA = a !in values
    val removedLast = values.remove(a + b)

    values.add(a - b)
    values[0] = a + b + b
    values.sort()

    val sortedFirst = values[0]
    val sortedLast = values.last()

    val more = ArrayList<Long>()
    more.add(a)
    more.add(0, b)

    values.clear()
    println("longList=$first,$last removed=$removedAt,$removedLast sorted=$sortedFirst,$sortedLast flags=$hadB,$missingA empty=${values.isEmpty()} extra=${more.first()} size=${values.size},${more.size}")
}
