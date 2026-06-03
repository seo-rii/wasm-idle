import java.util.PriorityQueue

fun main() {
    val a = readLong()
    val b = readLong()

    val pq = PriorityQueue<Long>()
    pq.add(a)
    pq.offer(b)
    pq.add(a - b)

    val peeked = pq.peek()
    val hadA = a in pq
    val missing = (a + b) !in pq
    val first = pq.poll()
    val second = pq.poll()

    val more = PriorityQueue<Long>()
    more.offer(a + b)
    more.add(b - b)
    val morePeek = more.peek()

    println("longPq=$peeked,$first,$second more=$morePeek flags=$hadA,$missing empty=${pq.isEmpty()},${more.isEmpty()} size=${pq.size},${more.size}")
}
