#include "shared/api.h"
#include <iostream>
#include <stdexcept>
int main() {
    std::vector<int> values(3);
    for (auto& value : values) if (!(std::cin >> value)) return 2;
    try { std::cout << second(first(values)) << ' ' << initializer_order << '\n'; }
    catch (const std::invalid_argument& error) { std::cout << error.what() << ' ' << initializer_order << '\n'; }
}
