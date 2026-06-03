import java.util.ArrayDeque

fun main() {
    val a = readLong()
    val b = readLong()

    val deque = ArrayDeque<Long>()
    deque.add(a)
    deque.addFirst(b)
    deque.addLast(a - b)
    deque.offer(a + b)
    deque.offerFirst(b - b)
    deque.offerLast(a + b + b)

    val firstValue = deque.first()
    val lastValue = deque.last()
    val peekValue = deque.peek()
    val peekLastValue = deque.peekLast()
    val hadA = a in deque
    val missing = (a - b - b) !in deque

    val polled = deque.poll()
    val removedFirst = deque.removeFirst()
    val removedLast = deque.removeLast()
    val edgeFirst = deque.getFirst()
    val edgeLast = deque.getLast()
    val pollLast = deque.pollLast()
    val pollFirst = deque.pollFirst()

    val more = ArrayDeque<Long>()
    more.offerLast(a)
    more.addFirst(b)

    println("longDeque=$firstValue,$lastValue peek=$peekValue,$peekLastValue removed=$polled,$removedFirst,$removedLast,$pollLast,$pollFirst edge=$edgeFirst,$edgeLast flags=$hadA,$missing empty=${deque.isEmpty()},${more.isEmpty()} size=${deque.size},${more.size} more=${more.peekFirst()},${more.peekLast()}")
}
