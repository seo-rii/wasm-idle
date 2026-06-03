fun main() {
    val n = readInt()
    val m = readInt()
    val grid = Array(n) { IntArray(m) }
    repeat(n) { i ->
        repeat(m) { j ->
            grid[i][j] = readInt()
        }
    }
    var diag = 0
    for (i in 0 until n) {
        diag += grid[i][i]
    }
    grid[0][1] += grid[1][0]
    println("grid=$diag edge=${grid[0][1]} size=${grid.size},${grid[0].size}")
}
