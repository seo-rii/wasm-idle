//go:build js && wasm

package main

import (
	"syscall/js"

	"github.com/seo-rii/wasm-idle/runtimes/wasm-awk/internal/runner"
)

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
	result := runner.Run(values[0].String(), values[1].String(), args)
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
