#include <immintrin.h>
#include <stdio.h>

__attribute__((noinline)) static void transform(const int *in, int *out, float *weights) {
    __m256i values = _mm256_loadu_si256((const __m256i *)in);
    _mm256_storeu_si256((__m256i *)out, _mm256_add_epi32(values, values));
    __m256 x = _mm256_cvtepi32_ps(values);
#ifdef __FMA__
    _mm256_storeu_ps(weights, _mm256_fmadd_ps(x, x, _mm256_set1_ps(1)));
#else
    _mm256_storeu_ps(weights, _mm256_add_ps(_mm256_mul_ps(x, x), _mm256_set1_ps(1)));
#endif
}

int main(void) {
    int in[8], out[8];
    float weights[8];
    for (int i = 0; i < 8; ++i)
        if (scanf("%d", &in[i]) != 1) return 1;
    transform(in, out, weights);
    for (int i = 0; i < 8; ++i) printf("%d %.0f\n", out[i], weights[i]);
    return 0;
}
