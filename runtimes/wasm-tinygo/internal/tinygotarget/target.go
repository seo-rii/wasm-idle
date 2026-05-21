package tinygotarget

import (
	"encoding/json"
	"fmt"
	"strings"

	"wasm-tinygo/internal/tinygoroot"
)

type Profile struct {
	Name             string
	LLVMTarget       string
	CPU              string
	Features         string
	GOOS             string
	GOARCH           string
	LibC             string
	RTLib            string
	GC               string
	Scheduler        string
	DefaultStackSize int
	Linker           string
	BuildTags        []string
	CFlags           []string
	LDFlags          []string
	ExtraFiles       []string
}

func Resolve(target string) (Profile, error) {
	if target == "" {
		target = "wasm"
	}
	source, ok := tinygoroot.TargetSource(target)
	if !ok {
		return Profile{}, fmt.Errorf("unsupported target: %q", target)
	}
	var parsed struct {
		LLVMTarget       string   `json:"llvm-target"`
		CPU              string   `json:"cpu"`
		Features         string   `json:"features"`
		BuildTags        []string `json:"build-tags"`
		GOOS             string   `json:"goos"`
		GOARCH           string   `json:"goarch"`
		Linker           string   `json:"linker"`
		LibC             string   `json:"libc"`
		RTLib            string   `json:"rtlib"`
		GC               string   `json:"gc"`
		Scheduler        string   `json:"scheduler"`
		DefaultStackSize int      `json:"default-stack-size"`
		CFlags           []string `json:"cflags"`
		LDFlags          []string `json:"ldflags"`
		ExtraFiles       []string `json:"extra-files"`
	}
	if err := json.Unmarshal([]byte(source), &parsed); err != nil {
		return Profile{}, fmt.Errorf("parse target profile %q: %w", target, err)
	}
	return Profile{
		Name:             target,
		LLVMTarget:       parsed.LLVMTarget,
		CPU:              parsed.CPU,
		Features:         parsed.Features,
		GOOS:             parsed.GOOS,
		GOARCH:           parsed.GOARCH,
		LibC:             parsed.LibC,
		RTLib:            parsed.RTLib,
		GC:               parsed.GC,
		Scheduler:        parsed.Scheduler,
		DefaultStackSize: parsed.DefaultStackSize,
		Linker:           parsed.Linker,
		BuildTags:        append([]string{}, parsed.BuildTags...),
		CFlags:           append([]string{}, parsed.CFlags...),
		LDFlags:          append([]string{}, parsed.LDFlags...),
		ExtraFiles:       append([]string{}, parsed.ExtraFiles...),
	}, nil
}

func (profile Profile) LinkerFlags() []string {
	flags := make([]string, 0, len(profile.LDFlags))
	for _, flag := range profile.LDFlags {
		if strings.Contains(flag, "{root}") {
			continue
		}
		flags = append(flags, flag)
	}
	return flags
}

func (profile Profile) BuildTagsFor(scheduler string) []string {
	if scheduler == "" {
		scheduler = profile.Scheduler
	}
	tags := append([]string{}, profile.BuildTags...)
	tags = append(tags,
		"tinygo",
		"purego",
		"osusergo",
		"math_big_pure_go",
		"gc."+profile.GC,
		"scheduler."+scheduler,
		"serial.none",
	)
	if scheduler != "threads" && scheduler != "cores" {
		tags = append(tags, "tinygo.unicore")
	}
	return tags
}
