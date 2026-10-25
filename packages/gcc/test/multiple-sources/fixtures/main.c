#include <stdio.h>
#include "shared.h"
#define PRIMARY_UNIT_ONLY 1

static int local_value = 2;

int main(void) {
    long long n;
    if (scanf("%lld", &n) != 1) return 2;
    printf("%lld %d\n", triangular(n) + bias(), local_value);
    return 0;
}
