package runner

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestRunProcessesStdin(t *testing.T) {
	result := Run(`{ print "main=" $1 + 5 }`, "68\n", nil)
	if result.Error != "" {
		t.Fatalf("Run returned error: %s", result.Error)
	}
	if result.Status != 0 {
		t.Fatalf("Run returned status %d", result.Status)
	}
	if result.Stdout != "main=73\n" {
		t.Fatalf("stdout = %q, want %q", result.Stdout, "main=73\n")
	}
}

func TestRunReportsParseError(t *testing.T) {
	result := Run(`{ print`, "", nil)
	if result.Error == "" {
		t.Fatal("Run returned no error for invalid AWK source")
	}
	if result.Status == 0 {
		t.Fatal("Run returned status 0 for invalid AWK source")
	}
}

func TestRunIOStreamsPromptBeforeReadingInput(t *testing.T) {
	stdin := &checkingReader{t: t, prompt: &bytes.Buffer{}, input: "68\n"}
	result := RunIO(
		`BEGIN { print "value?"; fflush(); getline line; print "main=" (line + 5) }`,
		stdin,
		stdin.prompt,
		&bytes.Buffer{},
		nil,
	)
	if result.Error != "" {
		t.Fatalf("RunIO returned error: %s", result.Error)
	}
	if result.Status != 0 {
		t.Fatalf("RunIO returned status %d", result.Status)
	}
	if got := stdin.prompt.String(); got != "value?\nmain=73\n" {
		t.Fatalf("stdout = %q, want %q", got, "value?\\nmain=73\\n")
	}
}

type checkingReader struct {
	t      *testing.T
	prompt *bytes.Buffer
	input  string
	offset int
}

func (reader *checkingReader) Read(target []byte) (int, error) {
	reader.t.Helper()
	if !strings.Contains(reader.prompt.String(), "value?\n") {
		reader.t.Fatal("stdin was read before the prompt was written")
	}
	if reader.offset >= len(reader.input) {
		return 0, io.EOF
	}
	count := copy(target, reader.input[reader.offset:])
	reader.offset += count
	return count, nil
}
