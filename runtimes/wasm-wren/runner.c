/* MIT licensed host bindings for the unchanged upstream Wren VM. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "wren.h"

static const char ioModule[] =
  "class Stdin {\n"
  "  foreign static readLine()\n"
  "  foreign static readByte()\n"
  "  static isTerminal { false }\n"
  "  static isRaw { false }\n"
  "}\n"
  "class Stdout {\n"
  "  static write(value) { writeString_(value.toString) }\n"
  "  static print(value) {\n"
  "    write(value)\n"
  "    writeString_(\"\\n\")\n"
  "  }\n"
  "  foreign static writeString_(text)\n"
  "  foreign static flush()\n"
  "  static isTerminal { false }\n"
  "}\n";

static void abortHost(WrenVM* vm, const char* message) {
  wrenSetSlotString(vm, 0, message);
  wrenAbortFiber(vm, 0);
}

static void readByte(WrenVM* vm) {
  int value = fgetc(stdin);
  if (value == EOF) wrenSetSlotNull(vm, 0);
  else wrenSetSlotDouble(vm, 0, value);
}

static void readLine(WrenVM* vm) {
  size_t size = 0, capacity = 128;
  char* buffer = malloc(capacity);
  if (!buffer) { abortHost(vm, "Could not allocate stdin buffer."); return; }
  int byte;
  while ((byte = fgetc(stdin)) != EOF && byte != '\n') {
    if (size == capacity) {
      char* grown = realloc(buffer, capacity * 2);
      if (!grown) { free(buffer); abortHost(vm, "Stdin line is too large."); return; }
      buffer = grown;
      capacity *= 2;
    }
    buffer[size++] = (char)byte;
  }
  if (byte == EOF && size == 0) wrenSetSlotNull(vm, 0);
  else {
    if (byte == '\n' && size && buffer[size - 1] == '\r') size--;
    wrenSetSlotBytes(vm, 0, buffer, size);
  }
  free(buffer);
}

static void writeString(WrenVM* vm) {
  if (wrenGetSlotType(vm, 1) != WREN_TYPE_STRING) {
    abortHost(vm, "Stdout requires a string.");
    return;
  }
  int length;
  const char* bytes = wrenGetSlotBytes(vm, 1, &length);
  fwrite(bytes, 1, (size_t)length, stdout);
}

static void flush(WrenVM* vm) {
  (void)vm;
  fflush(stdout);
}

static WrenForeignMethodFn bindMethod(WrenVM* vm, const char* module,
                                      const char* className, bool isStatic,
                                      const char* signature) {
  (void)vm;
  if (strcmp(module, "io") || !isStatic) return NULL;
  if (!strcmp(className, "Stdin")) {
    if (!strcmp(signature, "readLine()")) return readLine;
    if (!strcmp(signature, "readByte()")) return readByte;
  }
  if (!strcmp(className, "Stdout")) {
    if (!strcmp(signature, "writeString_(_)")) return writeString;
    if (!strcmp(signature, "flush()")) return flush;
  }
  return NULL;
}

static char* readFile(const char* path) {
  FILE* file = fopen(path, "rb");
  if (!file) return NULL;
  if (fseek(file, 0, SEEK_END) != 0) { fclose(file); return NULL; }
  long length = ftell(file);
  if (length < 0 || fseek(file, 0, SEEK_SET) != 0) { fclose(file); return NULL; }
  char* source = malloc((size_t)length + 1);
  if (!source) { fclose(file); return NULL; }
  size_t actual = fread(source, 1, (size_t)length, file);
  if (ferror(file)) { free(source); fclose(file); return NULL; }
  source[actual] = '\0';
  fclose(file);
  return source;
}

static void releaseModule(WrenVM* vm, const char* name, WrenLoadModuleResult result) {
  (void)vm; (void)name;
  free((void*)result.source);
}

static WrenLoadModuleResult loadModule(WrenVM* vm, const char* name) {
  (void)vm;
  WrenLoadModuleResult result = {0};
  if (!strcmp(name, "io")) { result.source = ioModule; return result; }
  size_t length = strlen(name);
  char* path = malloc(length + 6);
  if (!path) return result;
  snprintf(path, length + 6, "%s.wren", name);
  result.source = readFile(path);
  if (result.source) result.onComplete = releaseModule;
  free(path);
  return result;
}

/* Canonicalize relative workspace imports so one module is evaluated once. */
static const char* resolveModule(WrenVM* vm, const char* importer, const char* name) {
  (void)vm;
  if (!strcmp(name, "io") || !strcmp(name, "random") || !strcmp(name, "meta")) {
    char* result = malloc(strlen(name) + 1);
    if (result) strcpy(result, name);
    return result;
  }
  const char* slash = strrchr(importer, '/');
  size_t prefix = name[0] == '/' ? 0 : (slash ? (size_t)(slash - importer) + 1 : 0);
  char* combined = malloc(prefix + strlen(name) + 2);
  char* normalized = malloc(prefix + strlen(name) + 3);
  if (!combined || !normalized) { free(combined); free(normalized); return NULL; }
  memcpy(combined, importer, prefix);
  strcpy(combined + prefix, name);
  size_t out = 1;
  normalized[0] = '/';
  char* segment = combined;
  while (*segment) {
    while (*segment == '/') segment++;
    if (!*segment) break;
    char* end = strchr(segment, '/');
    size_t length = end ? (size_t)(end - segment) : strlen(segment);
    if (length == 2 && !strncmp(segment, "..", 2)) {
      if (out == 1) { free(combined); free(normalized); return NULL; }
      out--;
      while (out > 1 && normalized[out - 1] != '/') out--;
    } else if (!(length == 1 && *segment == '.')) {
      memcpy(normalized + out, segment, length);
      out += length;
      normalized[out++] = '/';
    }
    segment += length;
  }
  if (out > 1) out--;
  normalized[out] = '\0';
  free(combined);
  return normalized;
}

static void writeOutput(WrenVM* vm, const char* text) { (void)vm; fputs(text, stdout); }
static void writeError(WrenVM* vm, WrenErrorType type, const char* module,
                       int line, const char* message) {
  (void)vm;
  if (type == WREN_ERROR_RUNTIME) fprintf(stderr, "%s\n", message);
  else fprintf(stderr, "[%s line %d] %s\n", module ? module : "main", line, message);
}

int main(int argc, char** argv) {
  setvbuf(stdin, NULL, _IONBF, 0);
  setvbuf(stdout, NULL, _IONBF, 0);
  setvbuf(stderr, NULL, _IONBF, 0);
  if (argc != 2) { fputs("Usage: wren <script.wren>\n", stderr); return 64; }
  char* source = readFile(argv[1]);
  if (!source) { fprintf(stderr, "Could not read Wren source: %s\n", argv[1]); return 66; }
  WrenConfiguration config;
  wrenInitConfiguration(&config);
  config.writeFn = writeOutput;
  config.errorFn = writeError;
  config.loadModuleFn = loadModule;
  config.resolveModuleFn = resolveModule;
  config.bindForeignMethodFn = bindMethod;
  WrenVM* vm = wrenNewVM(&config);
  /* Import names omit .wren; give the entry module the same identity. */
  size_t moduleLength = strlen(argv[1]);
  char* moduleName = malloc(moduleLength + 1);
  if (!moduleName) { wrenFreeVM(vm); free(source); return 71; }
  memcpy(moduleName, argv[1], moduleLength + 1);
  if (moduleLength >= 5 && !strcmp(moduleName + moduleLength - 5, ".wren")) {
    moduleName[moduleLength - 5] = '\0';
  }
  WrenInterpretResult result = wrenInterpret(vm, moduleName, source);
  wrenFreeVM(vm);
  free(moduleName);
  free(source);
  return result == WREN_RESULT_SUCCESS ? 0 : result == WREN_RESULT_COMPILE_ERROR ? 65 : 70;
}
