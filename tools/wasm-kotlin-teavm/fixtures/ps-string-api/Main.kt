fun main() {
    val word = readString()
    val padded = "  KotlinGo  "
    val trimmed = padded.trim()
    val lower = trimmed.lowercase()
    val upper = lower.uppercase()
    val head = word.substring(0, 5)
    val tail = word.substring(5)
    val middle = word.substring(3, word.length - 2)

    var score = 0
    if (lower.startsWith("kotlin")) score += 1
    if (upper.endsWith("GO")) score += 2
    if (word.contains("rith")) score += 4
    if (word.contains('m')) score += 8

    println("str=$head|$tail|$middle idx=${word.indexOf('o')},${word.indexOf("go")},${word.lastIndexOf("go")} score=$score case=$lower/$upper")
}
