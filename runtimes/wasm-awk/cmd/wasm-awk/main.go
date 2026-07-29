//go:build js && wasm

package main

import (
	"fmt"
	"io"
	"syscall/js"

	"github.com/seo-rii/wasm-idle/runtimes/wasm-awk/internal/runner"
)

var uint8Array = js.Global().Get("Uint8Array")

type javascriptReader struct {
	value js.Value
}

func (reader javascriptReader) Read(target []byte) (count int, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			count = 0
			err = fmt.Errorf("AWK stdin reader failed: %v", recovered)
		}
	}()
	if len(target) == 0 {
		return 0, nil
	}
	chunk := reader.value.Call("read", len(target))
	if chunk.Type() != js.TypeObject || !chunk.InstanceOf(uint8Array) {
		return 0, fmt.Errorf("AWK stdin reader must return a Uint8Array")
	}
	length := chunk.Get("byteLength").Int()
	if length == 0 {
		return 0, io.EOF
	}
	if length > len(target) {
		return 0, fmt.Errorf("AWK stdin reader returned %d bytes for a %d-byte request", length, len(target))
	}
	if copied := js.CopyBytesToGo(target[:length], chunk); copied != length {
		return copied, fmt.Errorf("AWK stdin reader copied %d of %d bytes", copied, length)
	}
	return length, nil
}

type javascriptWriter struct {
	value js.Value
}

func (writer javascriptWriter) Write(source []byte) (count int, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			count = 0
			err = fmt.Errorf("AWK output writer failed: %v", recovered)
		}
	}()
	if len(source) == 0 {
		return 0, nil
	}
	chunk := uint8Array.New(len(source))
	if copied := js.CopyBytesToJS(chunk, source); copied != len(source) {
		return copied, fmt.Errorf("AWK output writer copied %d of %d bytes", copied, len(source))
	}
	writer.value.Invoke(chunk)
	return len(source), nil
}

func (writer javascriptWriter) Flush() error {
	return nil
}

func stringsFromJSArray(value js.Value) []string {
	if !value.Truthy() || value.Type() != js.TypeObject {
		return nil
	}
	length := value.Get("length").Int()
	args := make([]string, 0, length)
	for index := 0; index < length; index++ {
		args = append(args, value.Index(index).String())
	}
	return args
}

func runAwk(_ js.Value, values []js.Value) any {
	if len(values) < 2 {
		return map[string]any{
			"status": 2,
			"error":  "wasmIdleRunAwk requires source and stdin arguments",
		}
	}
	args := []string(nil)
	if len(values) >= 3 {
		args = stringsFromJSArray(values[2])
	}
	var result runner.Result
	if values[1].Type() == js.TypeString {
		result = runner.Run(values[0].String(), values[1].String(), args)
	} else {
		if values[1].Type() != js.TypeObject || values[1].Get("read").Type() != js.TypeFunction {
			return map[string]any{
				"status": 2,
				"error":  "wasmIdleRunAwk stdin must be a string or reader object",
			}
		}
		if len(values) < 4 || values[3].Type() != js.TypeObject {
			return map[string]any{
				"status": 2,
				"error":  "wasmIdleRunAwk requires output sinks for a reader stdin",
			}
		}
		stdout := values[3].Get("stdout")
		stderr := values[3].Get("stderr")
		if stdout.Type() != js.TypeFunction || stderr.Type() != js.TypeFunction {
			return map[string]any{
				"status": 2,
				"error":  "wasmIdleRunAwk output sinks must be functions",
			}
		}
		result = runner.RunIO(
			values[0].String(),
			javascriptReader{value: values[1]},
			javascriptWriter{value: stdout},
			javascriptWriter{value: stderr},
			args,
		)
	}
	return map[string]any{
		"stdout": result.Stdout,
		"stderr": result.Stderr,
		"status": result.Status,
		"error":  result.Error,
	}
}

func main() {
	js.Global().Set("wasmIdleRunAwk", js.FuncOf(runAwk))
	select {}
}
