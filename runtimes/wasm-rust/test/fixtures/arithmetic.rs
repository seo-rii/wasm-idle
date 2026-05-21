fn main() {
    let mut sum: i32 = 0;
    let mut value: i32 = 1;
    while value <= 3 {
        sum += value;
        value += 1;
    }
    println!("sum={sum}");
    println!("product={}", sum * 3);
}
