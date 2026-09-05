let count = Int(readLine() ?? "") ?? 0
let values = (readLine() ?? "").split(separator: " ").compactMap { Int($0) }
print("sum=\(values.prefix(max(0, count)).reduce(0, +))")
print("text=\(readLine() ?? "<eof>")")
print("eof=\(readLine() == nil)")
