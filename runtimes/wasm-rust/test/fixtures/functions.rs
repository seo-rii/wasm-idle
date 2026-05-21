fn multiply(lhs: i32, rhs: i32) -> i32 {
    return lhs * rhs;
}

fn banner(name: &str) {
    print!("hello ");
    println!("{name}");
}

fn main() {
    let value = multiply(6, 7);
    banner("rust");
    println!("value={value}");
}
