import java.util.ArrayList

fun addLongBucket(buckets: Array<ArrayList<Long>>, index: Int, value: Long) {
    buckets[index].add(value)
}

fun addWordBucket(buckets: Array<ArrayList<String>>, index: Int, value: String) {
    buckets[index].add(value)
}

fun main() {
    val base = readLong()
    val step = readLong()
    val first = readString()
    val second = readString()

    val longs = Array(2) { ArrayList<Long>() }
    addLongBucket(longs, 0, base)
    addLongBucket(longs, 0, step)
    longs[1].add(longs[0][0] + longs[0][1])

    val replacementLongs = mutableListOf<Long>()
    replacementLongs.add(base - step)
    replacementLongs.add(base + step)
    longs[1] = replacementLongs

    var longScore = 0L
    repeat(longs.size) {
        val bucket = longs[it]
        repeat(bucket.size) { index ->
            longScore += bucket[index]
        }
    }

    val words = Array(2) { ArrayList<String>() }
    addWordBucket(words, 0, first)
    words[0].add(second)
    words[1].add(words[0][0].uppercase())

    val replacementWords = mutableListOf<String>()
    replacementWords.add(second.lowercase())
    replacementWords.add(first.uppercase())
    words[1] = replacementWords

    var textScore = 0
    repeat(words.size) {
        val bucket = words[it]
        repeat(bucket.size) { index ->
            textScore += bucket[index].length
        }
    }

    println("scalarListArray=longs=${longs.size},${longs[0].size},${longs[1].size},$longScore words=${words.size},${words[0][1]},${words[1][0]},${words[1][1]},$textScore")
}
