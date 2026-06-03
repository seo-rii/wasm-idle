fun main() {
    val n = readInt()
    val builder = StringBuilder()
    repeat(n) { index ->
        if (index > 0) builder.append(' ')
        builder.append(readInt())
    }
    builder.append('|')
    builder.append("done")
    println("builder=${builder.toString()}")
}
