fn main() {
    let mut index: i32 = 1;
    let mut sum: i32 = 0;
    while index <= 5 {
        sum += index;
        index += 1;
    }
    println!("sum={sum}");
    if sum > 10 {
        println!("large");
    } else {
        println!("small");
    }
}
