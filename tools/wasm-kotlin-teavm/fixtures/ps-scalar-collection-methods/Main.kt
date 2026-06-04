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
    val listSize = list.size

    val queue = PriorityQueue<Int>()
    queue.add(4)
    queue.add(7)
    val queueHad = queue.contains(7)
    val queueRemoved = queue.remove(4)
    val queuePeek = queue.peek()
    val queueSize = queue.size

    val deque = ArrayDeque<Int>()
    deque.add(5)
    deque.add(8)
    val dequeHad = deque.contains(5)
    val dequeRemoved = deque.remove(8)
    val dequeLast = deque.last()
    val dequeSize = deque.size

    val longQueue = PriorityQueue<Long>()
    longQueue.add(100000000000L)
    longQueue.add(2L)
    val longHad = longQueue.contains(100000000000L)
    val longRemoved = longQueue.remove(2L)
    val longPeek = longQueue.peek()
    val longSize = longQueue.size

    val words = ArrayList<String>()
    words.add("alpha")
    words.add("beta")
    val wordHad = words.contains("beta")
    val wordRemoved = words.remove("alpha")
    val wordSize = words.size

    list.clear()
    queue.clear()
    deque.clear()
    longQueue.clear()
    words.clear()

    println("methods=list=$listHad,$listRemoved,$listMissing,$listSize queue=$queueHad,$queueRemoved,$queuePeek,$queueSize deque=$dequeHad,$dequeRemoved,$dequeLast,$dequeSize long=$longHad,$longRemoved,$longPeek,$longSize words=$wordHad,$wordRemoved,$wordSize clear=${list.isEmpty()},${queue.isEmpty()},${deque.size},${longQueue.isEmpty()},${words.size}")
}
