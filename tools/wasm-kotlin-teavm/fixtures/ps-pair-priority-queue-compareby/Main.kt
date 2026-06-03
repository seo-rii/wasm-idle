import java.util.PriorityQueue

fun main() {
    val bySecond = PriorityQueue<Pair<Int, Int>>(compareBy { it.second })
    bySecond.add(Pair(10, 5))
    bySecond.add(Pair(2, -1))
    bySecond.add(Pair(-3, -1))
    bySecond.add(Pair(1, 7))
    bySecond.offer(Pair(0, 5))

    val hadIn = Pair(2, -1) in bySecond
    val hadDirect = bySecond.contains(Pair(0, 5))
    val removed = bySecond.remove(Pair(10, 5))
    val missing = Pair(10, 5) !in bySecond
    val startSize = bySecond.size

    val peek = bySecond.peek()
    val first = bySecond.poll()
    val second = bySecond.poll()
    bySecond.add(Pair(-5, 0))
    val third = bySecond.poll()

    var score = 0
    while (!bySecond.isEmpty()) {
        val item = bySecond.poll()
        score += item.first * 100 + item.second
    }

    val byFirst = PriorityQueue<Pair<Int, Int>>(compareBy { it.first })
    byFirst.add(Pair(4, 0))
    byFirst.add(Pair(1, 99))
    val firstOrder = byFirst.poll()

    println("pairPqSecond=$startSize peek=${peek.first},${peek.second} first=${first.first},${first.second} second=${second.first},${second.second} third=${third.first},${third.second} score=$score flags=$hadIn,$hadDirect,$removed,$missing empty=${bySecond.isEmpty()} size=${bySecond.size} firstOrder=${firstOrder.first},${firstOrder.second}")
}
