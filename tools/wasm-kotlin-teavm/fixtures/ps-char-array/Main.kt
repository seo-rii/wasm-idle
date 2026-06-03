fun main() {
    val chars = readString().toCharArray()
    var i = 0
    var score = 0
    while (i < chars.size) {
        if (chars[i] == 'a') {
            chars[i] = 'z'
            score += i
        }
        i++
    }
    println("chars=${chars[0]}${chars[chars.size - 1]} score=$score")
}
