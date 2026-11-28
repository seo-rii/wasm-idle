#if __has_include("config.h/") || __has_include("config.h///") || __has_include(<stdio.h/>)
#error expected file names with trailing slashes to require a directory
#endif
#if __has_include("missing/../config.h") || __has_include("regular/../config.h") || __has_include("regular/./../config.h")
#error expected absent and regular path components to fail directory traversal
#endif
#if !__has_include("directory/./../config.h")
#error expected an existing directory to allow traversal
#endif
#if __has_include("stdio.h/../stdio.h") || !__has_include("linux/../stdio.h")
#error expected directory traversal to respect mounted sysroot file types
#endif
#include "directory/../config.h"
#include <stdio.h>
int main(void) { puts(RESULT); }
