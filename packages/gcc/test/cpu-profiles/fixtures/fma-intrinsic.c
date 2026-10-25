#include <immintrin.h>

#ifdef __cplusplus
extern "C"
#endif
void required_fma(float *out, const float *a, const float *b, const float *c) {
    _mm256_storeu_ps(out, _mm256_fmadd_ps(_mm256_loadu_ps(a),
        _mm256_loadu_ps(b), _mm256_loadu_ps(c)));
}
