#include <stdatomic.h>
#include <stdio.h>

typedef struct { unsigned long first, second; } Pair;
static _Atomic(Pair) shared;

int main(void) {
    Pair value;
    if (scanf("%lu %lu", &value.first, &value.second) != 2) return 1;
    atomic_store(&shared, value);
    Pair result = atomic_load(&shared);
    printf("%lu %lu\n", result.first, result.second);
    return 0;
}
