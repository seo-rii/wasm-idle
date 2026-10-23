#!/usr/bin/env python3
"""Prepare authenticated javacs source and the narrowly scoped browser platform patch."""
import difflib
import argparse
import hashlib
import json
import pathlib
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from toolchain import INPUTS, packaging_environment, pinned_jdk, verify_jdk

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/javacs-teavm'
REVISION = '7fffb6c5929fe02c52e1c823ae990bad2b540ad1'
SOURCE_SHA256 = 'fb7e94a7594f2e6bc9031b328ac38841d28270043a3dd9cb1f1f23ab7bc46674'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--jdk-home', type=pathlib.Path)
    parser.add_argument('--print-java-home', action='store_true')
    args = parser.parse_args()
    env = packaging_environment()
    if os.environ.get('LD_LIBRARY_PATH') != env['LD_LIBRARY_PATH']:
        os.execve(sys.executable, [sys.executable, __file__, *sys.argv[1:]], env)
    import zlib
    if zlib.ZLIB_RUNTIME_VERSION != INPUTS['zlib']['version']:
        raise ValueError('The pinned zlib packaging runtime is required')
    jdk = args.jdk_home.resolve() if args.jdk_home else pinned_jdk()
    java_version = verify_jdk(jdk)
    if args.print_java_home:
        print(jdk)
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / 'downloads/javacs.tar.gz'
    archive.parent.mkdir(exist_ok=True)
    if not archive.exists():
        archive.write_bytes(urllib.request.urlopen(
            'https://codeload.github.com/georgewfraser/java-language-server/tar.gz/' + REVISION,
            timeout=60).read())
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == SOURCE_SHA256
    source = CACHE / 'javacs'
    source.mkdir(exist_ok=True)
    if not list(source.iterdir()):
        subprocess.run(['tar', '-xzf', str(archive), '--strip-components=1', '--no-same-owner', '-C', str(source)], check=True)
    expected = set()
    with tarfile.open(archive) as packed:
        for entry in packed.getmembers():
            if not entry.isfile(): continue
            relative = '/'.join(entry.name.split('/')[1:])
            expected.add(relative)
            target = source / relative
            if target.is_symlink() or not target.is_file() or target.read_bytes() != packed.extractfile(entry).read():
                raise ValueError('Original javacs source tree differs: ' + relative)
    if {str(path.relative_to(source)) for path in source.rglob('*') if path.is_file()} != expected:
        raise ValueError('Original javacs source tree contains unexpected files')
    browser = CACHE / 'browser-source'
    if browser.exists(): shutil.rmtree(browser)
    shutil.copytree(source / 'src/main/java', browser)
    patches = []

    def patch(relative, old, new):
        target = browser / relative
        before = target.read_text()
        assert before.count(old) == 1, relative
        after = before.replace(old, new)
        target.write_text(after)
        patches.extend(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
            fromfile='a/src/main/java/' + relative, tofile='b/src/main/java/' + relative))

    patch('org/javacs/SourceFileManager.java',
        'var compiler = ServiceLoader.load(JavaCompiler.class).iterator().next();\n'
        '        return compiler.getStandardFileManager(SourceFileManager::logError, null, Charset.defaultCharset());',
        'return BrowserFileManager.create();')
    original = (browser / 'org/javacs/ScanClassPath.java').read_text()
    start = original.index('    static Set<String> jdkTopLevelClasses()')
    end = original.index('    private static URL toUrl', start)
    patch('org/javacs/ScanClassPath.java', original[start:end],
        '    static Set<String> jdkTopLevelClasses() {\n'
        '        return BrowserFileManager.platformClassNames();\n    }\n\n'
        '    static Set<String> classPathTopLevelClasses(Set<Path> classPath) {\n'
        '        if (!classPath.isEmpty()) throw new UnsupportedOperationException("External class paths are unavailable in this browser profile");\n'
        '        return Set.of();\n    }\n\n')
    original = (browser / 'org/javacs/JavaLanguageServer.java').read_text()
    start = original.index('    private JavaCompilerService createCompiler()')
    end = original.index('    private Set<String> externalDependencies()', start)
    patch('org/javacs/JavaLanguageServer.java', original[start:end],
        '    private JavaCompilerService createCompiler() {\n'
        '        Objects.requireNonNull(workspaceRoot);\n'
        '        if (!classPath().isEmpty() || !externalDependencies().isEmpty())\n'
        '            throw new UnsupportedOperationException("External dependency projects are unavailable in this browser profile");\n'
        '        return new JavaCompilerService(Set.of(), Set.of(), addExports());\n    }\n\n')
    original = (browser / 'org/javacs/Docs.java').read_text()
    start = original.index('    private static Path srcZip()')
    end = original.index('    private static Path findSrcZip()', start)
    patch('org/javacs/Docs.java', original[start:end],
        '    private static Path srcZip() { return NOT_FOUND; }\n\n')

    original = (browser / 'org/javacs/MarkdownHelper.java').read_text()
    start = original.index('    private static String htmlToMarkdown(String html)')
    end = original.index('    private static final Pattern HTML_TAG', start)
    patch('org/javacs/MarkdownHelper.java', original[start:end],
        '    private static String htmlToMarkdown(String html) {\n'
        '        return BrowserJavacs.formatHtml(replaceTags(html));\n    }\n\n')
    patch('org/javacs/JsonHelper.java', 'new GsonBuilder().create()',
        'new GsonBuilder().registerTypeAdapterFactory(new org.wasmidle.javacs.ProtocolAdapters()).create()')

    # TeaVM has no FileChannel; keep the original 1 MiB search buffer and search algorithm.
    original = (browser / 'org/javacs/StringSearch.java').read_text()
    before = 'try (var channel = FileChannel.open(java)) {\n' \
        '            // Read up to 1 MB of data from file\n' \
        '            var limit = Math.min((int) channel.size(), SEARCH_BUFFER.capacity());\n' \
        '            SEARCH_BUFFER.position(0);\n' \
        '            SEARCH_BUFFER.limit(limit);\n' \
        '            channel.read(SEARCH_BUFFER);\n' \
        '            SEARCH_BUFFER.position(0);'
    after = 'try (var input = Files.newInputStream(java)) {\n' \
        '            var bytes = input.readNBytes(SEARCH_BUFFER.capacity());\n' \
        '            SEARCH_BUFFER.position(0);\n' \
        '            SEARCH_BUFFER.limit(bytes.length);\n' \
        '            SEARCH_BUFFER.put(bytes);\n' \
        '            SEARCH_BUFFER.position(0);'
    assert original.count(before) == 3
    target = browser / 'org/javacs/StringSearch.java'
    changed = original.replace(before, after)
    target.write_text(changed)
    patches.extend(difflib.unified_diff(original.splitlines(True), changed.splitlines(True),
        fromfile='a/src/main/java/org/javacs/StringSearch.java', tofile='b/src/main/java/org/javacs/StringSearch.java'))

    # These optional Gson adapters cannot occur in javacs LSP DTOs. All protocol mapping remains upstream Gson.
    gson_archive = CACHE / 'downloads/gson-2.8.5-sources.jar'
    if not gson_archive.exists():
        gson_archive.write_bytes(urllib.request.urlopen(
            'https://repo.maven.apache.org/maven2/com/google/code/gson/gson/2.8.5/gson-2.8.5-sources.jar', timeout=60).read())
    assert hashlib.sha256(gson_archive.read_bytes()).hexdigest() == '512b4bf6927f4864acc419b8c5109c23361c30ed1f5798170248d33040de068e'
    with zipfile.ZipFile(gson_archive) as gson:
        for name in gson.namelist():
            if name.endswith('.java') and name.startswith('com/'):
                target = browser / name; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(gson.read(name))
        for name in ['com/google/gson/Gson.java', 'com/google/gson/GsonBuilder.java', 'com/google/gson/internal/bind/TypeAdapters.java']:
            target = browser / name; target.parent.mkdir(parents=True, exist_ok=True)
            before = gson.read(name).decode(); after = before
            if name.endswith('/Gson.java'):
                for line in ['    factories.add(TypeAdapters.newFactory(AtomicLongArray.class, atomicLongArrayAdapter(longAdapter)));\n',
                        '    factories.add(TypeAdapters.ATOMIC_INTEGER_ARRAY_FACTORY);\n',
                        '    factories.add(TimeTypeAdapter.FACTORY);\n', '    factories.add(SqlDateTypeAdapter.FACTORY);\n',
                        '    factories.add(TypeAdapters.TIMESTAMP_FACTORY);\n',
                        '    factories.add(TypeAdapters.INET_ADDRESS_FACTORY);\n',
                        '    factories.add(excluder);\n',
                        '    factories.add(new CollectionTypeAdapterFactory(constructorConstructor));\n',
                        '    factories.add(new MapTypeAdapterFactory(constructorConstructor, complexMapKeySerialization));\n',
                        '    factories.add(jsonAdapterFactory);\n']:
                    assert after.count(line) == 1; after = after.replace(line, '')
                after = after.replace('    this.jsonAdapterFactory = new JsonAdapterAnnotationTypeAdapterFactory(constructorConstructor);',
                    '    this.jsonAdapterFactory = null;')
                after = after.replace('    factories.add(new ReflectiveTypeAdapterFactory(\n'
                    '        constructorConstructor, fieldNamingStrategy, excluder, jsonAdapterFactory));\n', '')
            elif name.endswith('/GsonBuilder.java'):
                after = after.replace('    addTypeAdaptersForDate(datePattern, dateStyle, timeStyle, factories);', '')
            else:
                begin = after.index('  public static final TypeAdapter<AtomicIntegerArray> ATOMIC_INTEGER_ARRAY')
                end = after.index('\n  public static final ', after.index('      newFactory(AtomicIntegerArray.class', begin))
                after = after[:begin] + after[end:]
                begin = after.index('  public static final TypeAdapterFactory TIMESTAMP_FACTORY')
                end = after.index('\n  public static final ', begin + 10)
                after = after[:begin] + after[end:]
                begin = after.index('  public static final TypeAdapter<InetAddress> INET_ADDRESS')
                end = after.index('\n  public static final ', after.index('    newTypeHierarchyFactory(InetAddress.class', begin))
                after = after[:begin] + after[end:]
            target.write_text(after)
            patches.extend(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
                fromfile='gson-2.8.5/' + name, tofile='gson-browser/' + name))

    # An unmodified OpenJDK 8 utility (namespace change only) fills a missing TeaVM classlib class.
    joiner = CACHE / 'downloads/StringJoiner.java'
    if not joiner.exists():
        joiner.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/openjdk/jdk8u/jdk8u462-b08/jdk/src/share/classes/java/util/StringJoiner.java', timeout=60).read())
    assert hashlib.sha256(joiner.read_bytes()).hexdigest() == '14282396b179f13608d02c6918fb534aa0fbc90f0ac482c5c202f3d7f011e888'
    joiner_source = joiner.read_text().replace('package java.util;', 'package org.teavm.classlib.java.util;\nimport java.util.Objects;')
    joiner_source = joiner_source.replace('StringJoiner', 'TStringJoiner')
    target = browser / 'org/teavm/classlib/java/util/TStringJoiner.java'
    target.parent.mkdir(parents=True, exist_ok=True); target.write_text(joiner_source)
    platform_patch = ''.join(patches)
    (CACHE / 'browser-platform.patch').write_text(platform_patch)
    if (ROOT / 'producers/javacs-teavm/browser-platform.patch').read_text() != platform_patch:
        raise ValueError('Generated platform patch differs from the reviewed browser-platform.patch')

    dependencies = []
    for filename, url, expected in [
        ('gson-2.8.5.jar', 'com/google/code/gson/gson/2.8.5/gson-2.8.5.jar', '233a0149fc365c9f6edbd683cfe266b19bdc773be98eabdaf6b3c924b48e7d81'),
        ('protobuf-java-3.9.1.jar', 'com/google/protobuf/protobuf-java/3.9.1/protobuf-java-3.9.1.jar', '5a1e5c225791eccd3d67a598922e637406190c90155fb97f38e4eab29719324d')]:
        target = CACHE / 'downloads' / filename
        if not target.exists(): target.write_bytes(urllib.request.urlopen('https://repo.maven.apache.org/maven2/' + url, timeout=60).read())
        assert hashlib.sha256(target.read_bytes()).hexdigest() == expected
        dependencies.append(str(target))
    native = CACHE / 'native-classes'
    if native.exists(): shutil.rmtree(native)
    native.mkdir()
    exports = [item for package in ['api', 'code', 'comp', 'main', 'tree', 'model', 'util']
        for item in ['--add-exports', 'jdk.compiler/com.sun.tools.javac.' + package + '=ALL-UNNAMED']]
    subprocess.run([str(jdk / 'bin/javac'), '-J-Xmx768m', '-source', '13', '-target', '13', '-proc:none', '-d', str(native),
        '-cp', ':'.join(dependencies), *exports, *map(str, sorted((source / 'src/main/java').rglob('*.java')))], check=True)
    generator = CACHE / 'generator-classes'; generator.mkdir(exist_ok=True)
    subprocess.run([str(jdk / 'bin/javac'), '--release', '17', '-cp', dependencies[0], '-d', str(generator),
        str(ROOT / 'producers/javacs-teavm/tools/GenerateProtocolAdapters.java')], check=True)
    subprocess.run([str(jdk / 'bin/java'), '-cp', ':'.join([str(generator), str(native), dependencies[0]]), 'GenerateProtocolAdapters',
        str(native), str(browser / 'org/wasmidle/javacs/ProtocolAdapters.java')], check=True)
    verification = CACHE / 'verification-classes'; verification.mkdir(exist_ok=True)
    subprocess.run([str(jdk / 'bin/javac'), '--release', '17', '-cp', ':'.join([str(native), dependencies[0]]), '-d', str(verification),
        str(browser / 'org/wasmidle/javacs/ProtocolAdapters.java'),
        str(ROOT / 'producers/javacs-teavm/tools/VerifyProtocolAdapters.java')], check=True)
    subprocess.run([str(jdk / 'bin/java'), '-cp', ':'.join([str(verification), str(native), dependencies[0]]),
        'VerifyProtocolAdapters', str(native)], check=True)
    subprocess.run([str(jdk / 'bin/javac'), '--release', '17', '-d', str(verification),
        str(ROOT / 'producers/javacs-teavm/java/org/wasmidle/javacs/BrowserPlatformIO.java'),
        str(ROOT / 'producers/javacs-teavm/tools/VerifyPlatformIO.java')], check=True)
    subprocess.run([str(jdk / 'bin/java'), '-cp', str(verification), 'VerifyPlatformIO',
        str(CACHE / 'platform-io-fixture')], check=True)

    # Preserve the original handler dispatch table; only JVM framing/thread/queue is replaced.
    original = (source / 'src/main/java/org/javacs/lsp/LSP.java').read_text()
    start = original.index('                switch (r.method)')
    end = original.index('            } catch (Exception e) {', start)
    table = original[start:end].replace('respond(send, r.id,', 'respond(r.id,')
    table = table.replace('break processMessages;', 'return;')
    dispatcher = '''package org.javacs.lsp;
import com.google.gson.*;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.logging.Logger;
public final class BrowserDispatch {
    private static final Gson gson = org.javacs.JsonHelper.GSON;
    private static final Logger LOG = Logger.getLogger("main");
    private final LanguageServer server;
    private final Consumer<String> output;
    public BrowserDispatch(LanguageServer server, Consumer<String> output) { this.server = server; this.output = output; }
    private void respond(int id, Object result) {
        if (result instanceof Optional) result = ((Optional<?>) result).orElse(null);
        var message = new JsonObject(); message.addProperty("jsonrpc", "2.0"); message.addProperty("id", id);
        message.add("result", gson.toJsonTree(result)); output.accept(message.toString());
    }
    public void dispatch(String json) {
        var r = gson.fromJson(json, Message.class);
        if (r.method == null) return;
        try {
''' + table + '''
            server.doAsyncWork();
        } catch (Throwable e) {
            e.printStackTrace();
            if (r.id != null) {
                var error = new JsonObject(); error.addProperty("code", -32603); error.addProperty("message", e.toString());
                var message = new JsonObject(); message.addProperty("jsonrpc", "2.0"); message.addProperty("id", r.id);
                message.add("error", error); output.accept(message.toString());
            }
        }
    }
}
'''
    (browser / 'org/javacs/lsp/BrowserDispatch.java').write_text(dispatcher)

    for module, name in [('jdk.compiler', 'jdk-compiler.jar'), ('java.compiler', 'java-compiler.jar')]:
        with zipfile.ZipFile(jdk / 'jmods' / (module + '.jmod')) as src, zipfile.ZipFile(CACHE / name, 'w') as dst:
            for path in sorted(src.namelist()):
                if path.startswith('classes/') and path != 'classes/module-info.class':
                    info = zipfile.ZipInfo(path[8:], (2021, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                    dst.writestr(info, src.read(path))
    # TeaVM omits this abstract standard API. Retain the actual OpenJDK class,
    # not a sentence parser or a null-returning replacement. Javacs never sets a
    # custom iterator, so original DocTreeMaker keeps its defaultSentenceBreak.
    with zipfile.ZipFile(jdk / 'jmods/java.base.jmod') as src, zipfile.ZipFile(CACHE / 'jdk-support.jar', 'w') as dst:
        name = 'java/text/BreakIterator.class'
        info = zipfile.ZipInfo(name, (2021, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
        dst.writestr(info, src.read('classes/' + name))
    # The target compiler reads original class bytes, independently of TeaVM's execution classlib.
    with zipfile.ZipFile(CACHE / 'jdk-platform.zip', 'w') as dst:
        for module in ['java.base', 'java.logging', 'java.compiler', 'java.sql', 'java.xml', 'java.transaction.xa']:
            with zipfile.ZipFile(jdk / 'jmods' / (module + '.jmod')) as src:
                for path in sorted(src.namelist()):
                    if path.startswith('classes/') and path.endswith('.class'):
                        info = zipfile.ZipInfo(module + '/' + path[8:], (2021, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                        dst.writestr(info, src.read(path))
    print(json.dumps({'sourceRevision': REVISION, 'sourceSha256': SOURCE_SHA256,
        'platformPatchBytes': len(''.join(patches).encode()), 'javaVersion': java_version,
        'jdkModules': INPUTS['jdk']['modules'], 'zlibVersion': zlib.ZLIB_RUNTIME_VERSION}, indent=2))

if __name__ == '__main__': main()
