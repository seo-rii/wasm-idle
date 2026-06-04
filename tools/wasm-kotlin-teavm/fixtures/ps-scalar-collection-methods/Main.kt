import java.util.ArrayDeque
import java.util.ArrayList
import java.util.PriorityQueue

fun main() {
    val list = ArrayList<Int>()
    list.add(1)
    list.add(2)
    val listHad = list.contains(2)
    val listRemoved = list.remove(1)
    val listMissing = list.contains(1)

    val queue = PriorityQueue<Int>()
    queue.add(4)
    queue.add(7)
    val queueHad = queue.contains(7)
    val queueRemoved = queue.remove(4)
    val queuePeek = queue.peek()

    val deque = ArrayDeque<Int>()
    deque.add(5)
    deque.add(8)
    val dequeHad = deque.contains(5)
    val dequeRemoved = deque.remove(8)
    val dequeLast = deque.last()

    val longQueue = PriorityQueue<Long>()
    longQueue.add(100000000000L)
    longQueue.add(2L)
    val longHad = longQueue.contains(100000000000L)
    val longRemoved = longQueue.remove(2L)
    val longPeek = longQueue.peek()

    val words = ArrayList<String>()
    words.add("alpha")
    words.add("beta")
    val wordHad = words.contains("beta")
    val wordRemoved = words.remove("alpha")

    println("methods=list=$listHad,$listRemoved,$listMissing,${list.size} queue=$queueHad,$queueRemoved,$queuePeek deque=$dequeHad,$dequeRemoved,$dequeLast long=$longHad,$longRemoved,$longPeek words=$wordHad,$wordRemoved,${words.size}")
}
