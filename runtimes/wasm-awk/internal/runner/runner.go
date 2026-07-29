package runner

import (
	"bytes"
	"io"
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
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	result := RunIO(source, strings.NewReader(stdin), &stdout, &stderr, args)
	result.Stdout = stdout.String()
	result.Stderr = stderr.String()
	return result
}

func RunIO(source string, stdin io.Reader, stdout io.Writer, stderr io.Writer, args []string) Result {
	program, err := parser.ParseProgram([]byte(source), nil)
	if err != nil {
		return Result{Status: 2, Error: err.Error()}
	}

	status, err := interp.ExecProgram(program, &interp.Config{
		Stdin:         stdin,
		Output:        stdout,
		Error:         stderr,
		Argv0:         "awk",
		Args:          args,
		Environ:       []string{},
		NewlineOutput: interp.RawNewlineMode,
	})
	result := Result{
		Status: status,
	}
	if err != nil {
		result.Error = err.Error()
	}
	return result
}
