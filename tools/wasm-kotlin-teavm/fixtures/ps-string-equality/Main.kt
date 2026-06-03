fun main() {
    val a = readString()
    val b = readString()
    val same = a == b
    val diff = a != "stop"
    val score = if (a == "go" && b != "no") 7 else 3
    println("eq=$same diff=$diff score=$score")
}
