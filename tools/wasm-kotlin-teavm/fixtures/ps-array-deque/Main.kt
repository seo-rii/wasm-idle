import java.util.ArrayDeque

fun main() {
    val n = readInt()
    val deque = ArrayDeque<Int>()
    repeat(n) {
        deque.addLast(readInt())
    }
    deque.addFirst(3)
    deque.offerFirst(9)
    val tail = deque.pollLast()
    deque.offerLast(deque.first() + deque.last())
    val edge = deque.getFirst() + deque.getLast()
    val removed = deque.removeFirst() * 10 + deque.removeLast()
    deque.offer(4)

    var weighted = 0
    var index = 1
    while (!deque.isEmpty()) {
        weighted += deque.poll() * index
        index++
    }
    println("deque=$weighted edge=$edge removed=$removed tail=$tail count=${index - 1} size=${deque.size}")
}
