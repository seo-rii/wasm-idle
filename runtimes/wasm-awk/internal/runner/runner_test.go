package runner

import "testing"

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
