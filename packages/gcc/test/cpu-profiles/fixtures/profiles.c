#include "expected-profile.h"
#include <immintrin.h>

#if defined(__AVX2__) != EXPECT_AVX2
#error "AVX2 feature macro does not match the selected CPU profile"
#endif
#if defined(__FMA__) != EXPECT_FMA
#error "FMA feature macro does not match the selected CPU profile"
#endif

/* Permit contraction explicitly so the test does not depend on C/C++ defaults.
   The AVX2-only profile must still use separate multiply/add instructions. */
#pragma GCC optimize ("fp-contract=fast")

#ifdef __cplusplus
extern "C" {
#endif

void integer_add(int *out, const int *a, const int *b) {
#if EXPECT_AVX2
    _mm256_storeu_si256((__m256i *)out,
        _mm256_add_epi32(_mm256_loadu_si256((const __m256i *)a),
                         _mm256_loadu_si256((const __m256i *)b)));
#else
    _mm_storeu_si128((__m128i *)out,
        _mm_add_epi32(_mm_loadu_si128((const __m128i *)a),
                      _mm_loadu_si128((const __m128i *)b)));
#endif
}

double multiply_add(double a, double b, double c) {
    return a * b + c;
}

void vector_multiply_add(float *__restrict out, const float *__restrict a,
                         const float *__restrict b, const float *__restrict c) {
    for (int i = 0; i < 8; ++i) out[i] = a[i] * b[i] + c[i];
}

#ifdef __cplusplus
}
#endif
