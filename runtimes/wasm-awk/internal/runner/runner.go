package runner

import (
	"bytes"
	"strings"

	"github.com/benhoyt/goawk/interp"
	"github.com/benhoyt/goawk/parser"
)

type Result struct {
	Stdout string
	Stderr string
	Status int
	Error  string
}

func Run(source string, stdin string, args []string) Result {
	program, err := parser.ParseProgram([]byte(source), nil)
	if err != nil {
		return Result{Status: 2, Error: err.Error()}
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	status, err := interp.ExecProgram(program, &interp.Config{
		Stdin:         strings.NewReader(stdin),
		Output:        &stdout,
		Error:         &stderr,
		Argv0:         "awk",
		Args:          args,
		Environ:       []string{},
		NewlineOutput: interp.RawNewlineMode,
	})
	result := Result{
		Stdout: stdout.String(),
		Stderr: stderr.String(),
		Status: status,
	}
	if err != nil {
		result.Error = err.Error()
	}
	return result
}
