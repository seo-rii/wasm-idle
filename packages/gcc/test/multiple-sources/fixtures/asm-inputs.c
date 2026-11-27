#include <stdio.h>

extern const unsigned char header_bytes[];
extern const unsigned char embedded_object[];

int main(void) {
    printf("%u %u\n", header_bytes[0], embedded_object[0]);
}
