#include <arpa/nameser.h>
#include <cstdio>
#include <experimental/filesystem>

int main() {
    const unsigned char dns_header[12] = {};
    ns_msg message;
    if (ns_initparse(dns_header, sizeof(dns_header), &message) != 0) return 1;
    if (!std::experimental::filesystem::exists(".")) return 2;
    std::printf("%d %d\n", _GNU_SOURCE, ns_msg_count(message, ns_s_qd));
}
