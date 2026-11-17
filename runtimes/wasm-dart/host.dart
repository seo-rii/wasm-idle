// Host bindings for the original Dart DDC compiler. No user source is translated.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:js_interop';
import 'dart:typed_data';
import '__WASM_IDLE_USER_ENTRYPOINT__' as program;

@JS('__wasmIdleDartReadByte')
external int _readByte();
@JS('__wasmIdleDartReadChunk')
external JSUint8Array? _readChunk();
@JS('__wasmIdleDartWrite')
external void _write(JSUint8Array bytes, int stream);
@JS('__wasmIdleDartArgs')
external JSArray<JSString> _args();
@JS('__wasmIdleDartStarted')
external void _started();
@JS('__wasmIdleDartFinished')
external void _finished(int code);

final class _HostExit implements Exception {
  final int code;
  _HostExit(this.code);
}

final class _HostStdin extends Stream<List<int>> implements Stdin {
  bool _listened = false;

  @override
  int readByteSync() => _readByte();

  @override
  String? readLineSync({Encoding encoding = utf8, bool retainNewlines = false}) {
    final bytes = <int>[];
    while (true) {
      final byte = readByteSync();
      if (byte < 0) break;
      bytes.add(byte);
      if (byte == 10) break;
    }
    if (bytes.isEmpty) return null;
    if (!retainNewlines && bytes.last == 10) {
      bytes.removeLast();
      if (bytes.isNotEmpty && bytes.last == 13) bytes.removeLast();
    }
    return (encoding is SystemEncoding ? utf8 : encoding).decode(bytes);
  }

  @override
  StreamSubscription<List<int>> listen(void Function(List<int>)? onData,
      {Function? onError, void Function()? onDone, bool? cancelOnError}) {
    if (_listened) throw StateError('stdin has already been listened to');
    _listened = true;
    late StreamController<List<int>> controller;
    Timer? next;
    bool cancelled = false;
    bool paused = false;
    void pump() {
      if (cancelled || paused) return;
      try {
        final chunk = _readChunk();
        if (chunk == null) {
          controller.close();
        } else {
          controller.add(chunk.toDart);
          next = Timer(Duration.zero, pump);
        }
      } catch (error, stack) {
        controller.addError(error, stack);
        controller.close();
      }
    }
    controller = StreamController<List<int>>(onListen: () {
      scheduleMicrotask(pump);
    }, onPause: () {
      paused = true;
      next?.cancel();
    }, onResume: () {
      paused = false;
      next = Timer(Duration.zero, pump);
    }, onCancel: () {
      cancelled = true;
      next?.cancel();
    });
    return controller.stream.listen(onData,
        onError: onError, onDone: onDone, cancelOnError: cancelOnError);
  }

  @override
  bool get hasTerminal => false;
  @override
  bool get supportsAnsiEscapes => false;
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Dart browser stdin: ${invocation.memberName}');
}

final class _HostStdout implements Stdout {
  final int stream;
  @override
  Encoding encoding = utf8;
  _HostStdout(this.stream);

  @override
  void add(List<int> data) => _write(Uint8List.fromList(data).toJS, stream);
  @override
  void write(Object? object) => add(encoding.encode('$object'));
  @override
  void writeln([Object? object = '']) => write('$object\n');
  @override
  void writeAll(Iterable objects, [String separator = '']) =>
      write(objects.join(separator));
  @override
  void writeCharCode(int charCode) => write(String.fromCharCode(charCode));
  @override
  Future<void> addStream(Stream<List<int>> stream) async {
    await for (final data in stream) {
      add(data);
    }
  }

  @override
  Future<void> flush() async {}
  @override
  Future<void> close() async {}
  @override
  Future<void> get done async {}
  @override
  bool get hasTerminal => false;
  @override
  bool get supportsAnsiEscapes => false;
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Dart browser stdout: ${invocation.memberName}');
}

Future<void> main() async {
  final output = _HostStdout(1);
  final errors = _HostStdout(2);
  _started();
  try {
    await runZoned(() async {
      await IOOverrides.runZoned(() async {
        Function entry = program.main;
        final arguments = _args().toDart.map((value) => value.toDart).toList();
        final result = entry is dynamic Function(List<String>)
            ? entry(arguments)
            : Function.apply(entry, const []);
        if (result is Future) await result;
      }, stdin: () => _HostStdin(), stdout: () => output, stderr: () => errors,
          exit: (code) => throw _HostExit(code));
    }, zoneSpecification: ZoneSpecification(
      print: (self, parent, zone, line) => output.writeln(line),
    ));
    _finished(0);
  } on _HostExit catch (exit) {
    _finished(exit.code);
  } catch (error, stack) {
    errors.writeln(error);
    errors.writeln(stack);
    _finished(1);
  }
}
