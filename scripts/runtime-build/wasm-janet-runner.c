#include <stdio.h>
#include <stdlib.h>

#include "janet.h"

static unsigned char *read_all(const char *path, long *out_len) {
    FILE *file = fopen(path, "rb");
    unsigned char *buffer = NULL;
    long len;

    if (!file) return NULL;
    if (fseek(file, 0, SEEK_END) != 0) {
        fclose(file);
        return NULL;
    }
    len = ftell(file);
    if (len < 0 || fseek(file, 0, SEEK_SET) != 0) {
        fclose(file);
        return NULL;
    }
    buffer = malloc((size_t) len + 1);
    if (!buffer) {
        fclose(file);
        return NULL;
    }
    if (len > 0 && fread(buffer, 1, (size_t) len, file) != (size_t) len) {
        free(buffer);
        fclose(file);
        return NULL;
    }
    fclose(file);
    buffer[len] = '\0';
    *out_len = len;
    return buffer;
}

int main(int argc, char **argv) {
    JanetTable *env;
    unsigned char *source;
    long source_len = 0;
    int status;

    if (argc < 2) {
        fputs("usage: janet-runner <source.janet>\n", stderr);
        return 64;
    }

    source = read_all(argv[1], &source_len);
    if (!source) {
        fprintf(stderr, "failed to read source file: %s\n", argv[1]);
        return 66;
    }

    janet_init();
    env = janet_core_env(NULL);
    status = janet_dobytes(env, source, (int32_t) source_len, argv[1], NULL);
    janet_deinit();
    free(source);
    return status ? 1 : 0;
}
