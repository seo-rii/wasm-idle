#include <stdio.h>

#if !defined(__wasm_simd128__) && (defined(__SSE__) || defined(__SSE2__) || defined(__SSE3__) || defined(__SSSE3__) || defined(__SSE4_1__) || defined(__SSE4_2__) || defined(__AVX__) || defined(__AVX2__))
#error "Disabled Wasm SIMD must not advertise x86 SIMD support"
#endif

#ifdef __SSE2__
#include <immintrin.h>
#endif

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 1;
#ifdef __SSE2__
    int value = _mm_cvtsi128_si32(_mm_add_epi32(_mm_set1_epi32(n), _mm_set1_epi32(5)));
    printf("path=simd value=%d\n", value);
#else
    printf("path=scalar value=%d\n", n + 5);
#endif
    return 0;
}
