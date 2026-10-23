#include <x86intrin.h>
#include <stdio.h>
#include <wasm_simd128.h>

#if !defined(__wasm_simd128__) || !defined(__AVX2__)
#error "The Wasm SIMD compatibility profile must be enabled"
#endif

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 2;

    /* Unaligned memory access and all lanes of an SSE2 vector. */
    int input[9] = {0, n, n + 1, n + 2, n + 3, n + 4, n + 5, n + 6, n + 7};
    int sse[5] = {0};
    __m128i a = _mm_loadu_si128((const __m128i *)(input + 1));
    _mm_storeu_si128((__m128i *)(sse + 1), _mm_add_epi32(a, _mm_set1_epi32(5)));
    for (int i = 0; i < 4; ++i) if (sse[i + 1] != n + i + 5) return 3;

    /* AVX2's eight lanes cross the boundary between two Wasm v128 values. */
    int avx[9] = {0};
    __m256i b = _mm256_loadu_si256((const __m256i *)(input + 1));
    __m256i shifted = _mm256_slli_epi32(b, 2);
    _mm256_storeu_si256((__m256i *)(avx + 1), shifted);
    for (int i = 0; i < 8; ++i) if (avx[i + 1] != (n + i) * 4) return 4;
    __m128i high = _mm256_extracti128_si256(shifted, 1);
    if (_mm_extract_epi32(high, 0) != (n + 4) * 4) return 5;

    /* SSSE3 byte shuffle, SSE4.2 comparison and SSE floating point. */
    __m128i bytes = _mm_setr_epi8(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    __m128i reverse = _mm_shuffle_epi8(bytes, _mm_setr_epi8(15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0));
    if (_mm_extract_epi8(reverse, 0) != 15 || _mm_extract_epi8(reverse, 15) != 0) return 6;
    if (_mm_movemask_epi8(_mm_cmpgt_epi64(_mm_set1_epi64x(n + 1), _mm_set1_epi64x(n))) != 65535) return 7;
    float floats[4];
    _mm_storeu_ps(floats, _mm_add_ps(_mm_set1_ps((float)n), _mm_set1_ps(0.5f)));
    for (int i = 0; i < 4; ++i) if (floats[i] != (float)n + 0.5f) return 8;

    /* AVX float arithmetic must retain both halves too. */
    float wide[8];
    _mm256_storeu_ps(wide, _mm256_add_ps(_mm256_setr_ps(0, 1, 2, 3, 4, 5, 6, 7), _mm256_set1_ps((float)n)));
    for (int i = 0; i < 8; ++i) if (wide[i] != (float)(n + i)) return 9;

    v128_t native = wasm_i32x4_add(wasm_i32x4_splat(n), wasm_i32x4_make(0, 1, 2, 3));
    int last = wasm_i32x4_extract_lane(native, 3);
    if (last != n + 3) return 10;

    /* The x86 allocation API must use the portable WASI allocator. */
    unsigned char *aligned = (unsigned char *)_mm_malloc(17, 32);
    if (!aligned || (size_t)aligned % 32) return 11;
    aligned[0] = (unsigned char)n;
    aligned[16] = 42;
    if (aligned[0] != (unsigned char)n || aligned[16] != 42) return 12;
    _mm_free(aligned);
    printf("simd=%d sse=%d avx2=%d wasm=%d\n", n, sse[1], avx[8], last);
    return 0;
}
