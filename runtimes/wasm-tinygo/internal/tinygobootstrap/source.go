package tinygobootstrap

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

type Toolchain struct {
	Target              string   `json:"target"`
	LLVMTarget          string   `json:"llvmTarget,omitempty"`
	Linker              string   `json:"linker,omitempty"`
	CFlags              []string `json:"cflags,omitempty"`
	LDFlags             []string `json:"ldflags,omitempty"`
	TranslationUnitPath string   `json:"translationUnitPath,omitempty"`
	ObjectOutputPath    string   `json:"objectOutputPath,omitempty"`
	ArtifactOutputPath  string   `json:"artifactOutputPath,omitempty"`
}

type SourceSelection struct {
	AllCompile []string `json:"allCompile"`
}

type CompileUnit struct {
	Kind        string   `json:"kind"`
	ImportPath  string   `json:"importPath"`
	Imports     []string `json:"imports"`
	ModulePath  string   `json:"modulePath"`
	DepOnly     bool     `json:"depOnly"`
	PackageName string   `json:"packageName"`
	PackageDir  string   `json:"packageDir"`
	Files       []string `json:"files"`
	Standard    bool     `json:"standard"`
}

type CompileUnitManifest struct {
	EntryFile         string          `json:"entryFile"`
	OptimizeFlag      string          `json:"optimizeFlag,omitempty"`
	MaterializedFiles []string        `json:"materializedFiles,omitempty"`
	Toolchain         Toolchain       `json:"toolchain"`
	SourceSelection   SourceSelection `json:"sourceSelection"`
	CompileUnits      []CompileUnit   `json:"compileUnits,omitempty"`
}

type Input struct {
	CompileUnitManifest CompileUnitManifest
	OptimizeFlag        string
}

type Output struct {
	Source           string
	EmbeddedManifest string
}

func Generate(input Input) (Output, error) {
	manifest := input.CompileUnitManifest
	if manifest.OptimizeFlag == "" {
		manifest.OptimizeFlag = input.OptimizeFlag
	}
	if manifest.Toolchain.Target == "" {
		return Output{}, fmt.Errorf("toolchain target is required")
	}
	if manifest.Toolchain.ArtifactOutputPath == "" {
		return Output{}, fmt.Errorf("toolchain artifact output path is required")
	}
	if manifest.SourceSelection.AllCompile == nil {
		return Output{}, fmt.Errorf("source selection is required")
	}
	entryPackageDir := filepath.Dir(manifest.EntryFile)
	allCompileFiles := append([]string{}, manifest.SourceSelection.AllCompile...)
	stdlibPackageFiles := make([]string, 0, len(allCompileFiles))
	importedPackageFiles := make([]string, 0, len(allCompileFiles))
	packageFiles := make([]string, 0, len(allCompileFiles))
	if len(manifest.CompileUnits) != 0 {
		allCompileFileSet := map[string]struct{}{}
		for _, path := range allCompileFiles {
			allCompileFileSet[path] = struct{}{}
		}
		seenCompileFiles := map[string]struct{}{}
		for index := range manifest.CompileUnits {
			compileUnit := manifest.CompileUnits[index]
			if compileUnit.Kind == "" {
				return Output{}, fmt.Errorf("compile unit kind is required")
			}
			if compileUnit.ImportPath == "" {
				return Output{}, fmt.Errorf("compile unit importPath is required")
			}
			if compileUnit.PackageName == "" {
				return Output{}, fmt.Errorf("compile unit packageName is required")
			}
			if compileUnit.PackageDir == "" {
				return Output{}, fmt.Errorf("compile unit packageDir is required")
			}
			if len(compileUnit.Files) == 0 {
				return Output{}, fmt.Errorf("compile unit files are required")
			}
			unitImports := append([]string{}, compileUnit.Imports...)
			sort.Strings(unitImports)
			for _, importPath := range unitImports {
				if importPath == "" {
					return Output{}, fmt.Errorf("compile unit imports must not contain empty paths")
				}
			}
			compileUnit.Imports = unitImports
			for _, path := range compileUnit.Files {
				if filepath.Dir(path) != compileUnit.PackageDir {
					return Output{}, fmt.Errorf("compile unit files must stay inside packageDir")
				}
				if _, ok := allCompileFileSet[path]; !ok {
					return Output{}, fmt.Errorf("compile units must only reference allCompile files")
				}
				if _, ok := seenCompileFiles[path]; ok {
					return Output{}, fmt.Errorf("compile units must not repeat files")
				}
				seenCompileFiles[path] = struct{}{}
			}
			switch compileUnit.Kind {
			case "program":
				compileUnit.DepOnly = false
				compileUnit.Standard = false
				packageFiles = append(packageFiles, compileUnit.Files...)
			case "imported":
				compileUnit.DepOnly = true
				compileUnit.Standard = false
				importedPackageFiles = append(importedPackageFiles, compileUnit.Files...)
			case "stdlib":
				compileUnit.DepOnly = true
				compileUnit.Standard = true
				stdlibPackageFiles = append(stdlibPackageFiles, compileUnit.Files...)
			default:
				return Output{}, fmt.Errorf("unsupported compile unit kind %q", compileUnit.Kind)
			}
			manifest.CompileUnits[index] = compileUnit
		}
		if len(seenCompileFiles) != len(allCompileFileSet) {
			return Output{}, fmt.Errorf("compile units must cover every allCompile file")
		}
	} else {
		for _, path := range allCompileFiles {
			if strings.HasPrefix(path, "/working/.tinygo-root/src/") {
				stdlibPackageFiles = append(stdlibPackageFiles, path)
				continue
			}
			if filepath.Dir(path) != entryPackageDir {
				importedPackageFiles = append(importedPackageFiles, path)
				continue
			}
			packageFiles = append(packageFiles, path)
		}
	}
	entrySeen := false
	for _, path := range packageFiles {
		if path == manifest.EntryFile {
			entrySeen = true
			break
		}
	}
	if !entrySeen {
		return Output{}, fmt.Errorf("source selection all compile files must include the entry file")
	}
	embeddedSourceSelection := manifest.SourceSelection
	embeddedManifest, err := json.Marshal(struct {
		EntryFile         string          `json:"entryFile"`
		OptimizeFlag      string          `json:"optimizeFlag,omitempty"`
		MaterializedFiles []string        `json:"materializedFiles"`
		Toolchain         Toolchain       `json:"toolchain"`
		SourceSelection   SourceSelection `json:"sourceSelection"`
		CompileUnits      []CompileUnit   `json:"compileUnits,omitempty"`
	}{
		EntryFile:         manifest.EntryFile,
		OptimizeFlag:      manifest.OptimizeFlag,
		MaterializedFiles: manifest.MaterializedFiles,
		Toolchain:         manifest.Toolchain,
		SourceSelection:   embeddedSourceSelection,
		CompileUnits:      append([]CompileUnit{}, manifest.CompileUnits...),
	})
	if err != nil {
		return Output{}, err
	}
	quotedEmbeddedManifest, err := json.Marshal(string(embeddedManifest))
	if err != nil {
		return Output{}, err
	}
	bootstrapSource := strings.Builder{}
	bootstrapSource.WriteString("/* generated by wasm-tinygo tinygo bootstrap frontend */\n")
	fmt.Fprintf(&bootstrapSource, "/* entry: %s */\n", manifest.EntryFile)
	fmt.Fprintf(&bootstrapSource, "/* package-files: %d */\n", len(packageFiles))
	fmt.Fprintf(&bootstrapSource, "/* imported-files: %d */\n", len(importedPackageFiles))
	fmt.Fprintf(&bootstrapSource, "/* stdlib-files: %d */\n", len(stdlibPackageFiles))
	fmt.Fprintf(&bootstrapSource, "/* all-files: %d */\n", len(allCompileFiles))
	bootstrapSource.WriteString("\n")
	bootstrapSource.WriteString("static const char *tinygo_package_files[] = {\n")
	if len(packageFiles) == 0 {
		bootstrapSource.WriteString("    ((const char *)0),\n")
	} else {
		for _, path := range packageFiles {
			quotedPath, err := json.Marshal(path)
			if err != nil {
				return Output{}, err
			}
			fmt.Fprintf(&bootstrapSource, "    %s,\n", quotedPath)
		}
	}
	bootstrapSource.WriteString("};\n\n")
	bootstrapSource.WriteString("static const char *tinygo_imported_package_files[] = {\n")
	if len(importedPackageFiles) == 0 {
		bootstrapSource.WriteString("    ((const char *)0),\n")
	} else {
		for _, path := range importedPackageFiles {
			quotedPath, err := json.Marshal(path)
			if err != nil {
				return Output{}, err
			}
			fmt.Fprintf(&bootstrapSource, "    %s,\n", quotedPath)
		}
	}
	bootstrapSource.WriteString("};\n\n")
	bootstrapSource.WriteString("static const char *tinygo_stdlib_package_files[] = {\n")
	if len(stdlibPackageFiles) == 0 {
		bootstrapSource.WriteString("    ((const char *)0),\n")
	} else {
		for _, path := range stdlibPackageFiles {
			quotedPath, err := json.Marshal(path)
			if err != nil {
				return Output{}, err
			}
			fmt.Fprintf(&bootstrapSource, "    %s,\n", quotedPath)
		}
	}
	bootstrapSource.WriteString("};\n\n")
	bootstrapSource.WriteString("static const char *tinygo_all_compile_files[] = {\n")
	if len(allCompileFiles) == 0 {
		bootstrapSource.WriteString("    ((const char *)0),\n")
	} else {
		for _, path := range allCompileFiles {
			quotedPath, err := json.Marshal(path)
			if err != nil {
				return Output{}, err
			}
			fmt.Fprintf(&bootstrapSource, "    %s,\n", quotedPath)
		}
	}
	bootstrapSource.WriteString("};\n\n")
	fmt.Fprintf(&bootstrapSource, "static const char tinygo_embedded_manifest_json[] = %s;\n\n", quotedEmbeddedManifest)
	fmt.Fprintf(&bootstrapSource, "unsigned int tinygo_embedded_manifest_len(void) {\n    return %du;\n}\n\n", uint32(len(embeddedManifest)))
	bootstrapSource.WriteString("const char *tinygo_embedded_manifest_ptr(void) {\n    return tinygo_embedded_manifest_json;\n}\n\n")
	bootstrapSource.WriteString("int main(void) {\n")
	bootstrapSource.WriteString("    return tinygo_embedded_manifest_len() == 0u ? 1 : 0;\n")
	bootstrapSource.WriteString("}\n")
	return Output{
		Source:           bootstrapSource.String(),
		EmbeddedManifest: string(embeddedManifest),
	}, nil
}
