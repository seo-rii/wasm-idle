package tinygobackend

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path"
	"strconv"
	"strings"
)

type Input struct {
	EntryFile        string        `json:"entryFile"`
	OptimizeFlag     string        `json:"optimizeFlag,omitempty"`
	CompileJobs      []CompileJob  `json:"compileJobs"`
	LinkJob          LinkJob       `json:"linkJob"`
	ExecutionLinkJob *LinkJob      `json:"executionLinkJob,omitempty"`
	LoweredUnits     []LoweredUnit `json:"loweredUnits,omitempty"`
}

type CompileJob struct {
	ID                string   `json:"id"`
	Kind              string   `json:"kind"`
	ImportPath        string   `json:"importPath,omitempty"`
	Imports           []string `json:"imports"`
	DepOnly           bool     `json:"depOnly"`
	ModulePath        string   `json:"modulePath"`
	PackageName       string   `json:"packageName,omitempty"`
	PackageDir        string   `json:"packageDir"`
	Files             []string `json:"files"`
	BitcodeOutputPath string   `json:"bitcodeOutputPath"`
	LLVMTarget        string   `json:"llvmTarget"`
	CFlags            []string `json:"cflags"`
	OptimizeFlag      string   `json:"optimizeFlag,omitempty"`
	Standard          bool     `json:"standard"`
}

type LinkJob struct {
	Linker             string   `json:"linker"`
	LDFlags            []string `json:"ldflags"`
	ArtifactOutputPath string   `json:"artifactOutputPath"`
	BitcodeInputs      []string `json:"bitcodeInputs,omitempty"`
}

type LoweredUnit struct {
	ID                string   `json:"id"`
	Kind              string   `json:"kind"`
	ImportPath        string   `json:"importPath,omitempty"`
	Imports           []string `json:"imports"`
	DepOnly           bool     `json:"depOnly"`
	ModulePath        string   `json:"modulePath"`
	PackageName       string   `json:"packageName,omitempty"`
	PackageDir        string   `json:"packageDir"`
	SourceFiles       []string `json:"sourceFiles"`
	LoweredSourcePath string   `json:"loweredSourcePath"`
	Standard          bool     `json:"standard"`
}

type LoweredSourcesManifest struct {
	EntryFile    string        `json:"entryFile"`
	OptimizeFlag string        `json:"optimizeFlag,omitempty"`
	Units        []LoweredUnit `json:"units"`
}

type LoweredIRImport struct {
	Path  string `json:"path"`
	Alias string `json:"alias,omitempty"`
}

type LoweredIRFunction struct {
	Name       string `json:"name"`
	Exported   bool   `json:"exported"`
	Method     bool   `json:"method"`
	Main       bool   `json:"main"`
	Init       bool   `json:"init"`
	Parameters int    `json:"parameters"`
	Results    int    `json:"results"`
}

type LoweredIRType struct {
	Name     string `json:"name"`
	Exported bool   `json:"exported"`
	Kind     string `json:"kind"`
}

type LoweredIRConstant struct {
	Name     string `json:"name"`
	Exported bool   `json:"exported"`
}

type LoweredIRVariable struct {
	Name     string `json:"name"`
	Exported bool   `json:"exported"`
}

type LoweredIRDeclaration struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Exported bool   `json:"exported"`
	Method   bool   `json:"method"`
}

type LoweredIRLoweringBlock struct {
	Stage     string `json:"stage"`
	Index     int    `json:"index"`
	Value     string `json:"value"`
	Signature string `json:"signature,omitempty"`
}

type LoweredIRUnit struct {
	ID                string                   `json:"id"`
	Kind              string                   `json:"kind"`
	ImportPath        string                   `json:"importPath,omitempty"`
	ModulePath        string                   `json:"modulePath"`
	PackageDir        string                   `json:"packageDir"`
	SourceFiles       []string                 `json:"sourceFiles"`
	LoweredSourcePath string                   `json:"loweredSourcePath"`
	PackageName       string                   `json:"packageName"`
	Imports           []LoweredIRImport        `json:"imports"`
	Functions         []LoweredIRFunction      `json:"functions"`
	Types             []LoweredIRType          `json:"types"`
	Constants         []LoweredIRConstant      `json:"constants"`
	Variables         []LoweredIRVariable      `json:"variables"`
	Declarations      []LoweredIRDeclaration   `json:"declarations"`
	PlaceholderBlocks []LoweredIRLoweringBlock `json:"placeholderBlocks"`
	LoweringBlocks    []LoweredIRLoweringBlock `json:"loweringBlocks"`
}

type LoweredIRManifest struct {
	EntryFile    string          `json:"entryFile"`
	OptimizeFlag string          `json:"optimizeFlag,omitempty"`
	Units        []LoweredIRUnit `json:"units"`
}

type LoweredBitcodeManifest struct {
	BitcodeFiles []string `json:"bitcodeFiles"`
}

type GeneratedFile struct {
	Path     string `json:"path"`
	Contents string `json:"contents"`
}

type CommandInvocation struct {
	Argv []string `json:"argv"`
	Cwd  string   `json:"cwd"`
}

type CommandBatchManifest struct {
	CompileCommands []CommandInvocation `json:"compileCommands"`
	LinkCommand     CommandInvocation   `json:"linkCommand"`
}

type LoweredArtifactManifest struct {
	ArtifactOutputPath string   `json:"artifactOutputPath"`
	ArtifactKind       string   `json:"artifactKind,omitempty"`
	Entrypoint         *string  `json:"entrypoint"`
	ObjectFiles        []string `json:"objectFiles"`
	Reason             string   `json:"reason,omitempty"`
	Runnable           bool     `json:"runnable"`
}

type CommandArtifactManifest struct {
	ArtifactOutputPath string   `json:"artifactOutputPath"`
	ArtifactKind       string   `json:"artifactKind,omitempty"`
	BitcodeFiles       []string `json:"bitcodeFiles"`
	Entrypoint         *string  `json:"entrypoint"`
	Reason             string   `json:"reason,omitempty"`
	Runnable           bool     `json:"runnable"`
}

type Result struct {
	OK             bool            `json:"ok"`
	GeneratedFiles []GeneratedFile `json:"generatedFiles,omitempty"`
	Diagnostics    []string        `json:"diagnostics,omitempty"`
}

func Build(input Input) (Result, error) {
	optimizeFlag := input.OptimizeFlag
	for _, compileJob := range input.CompileJobs {
		if compileJob.OptimizeFlag != "" {
			optimizeFlag = compileJob.OptimizeFlag
			break
		}
	}
	loweredUnits := append([]LoweredUnit{}, input.LoweredUnits...)
	if len(loweredUnits) == 0 {
		loweredUnits = make([]LoweredUnit, 0, len(input.CompileJobs))
		for _, compileJob := range input.CompileJobs {
			if compileJob.ID == "" {
				return Result{}, fmt.Errorf("compile job id is required")
			}
			if compileJob.Kind == "" {
				return Result{}, fmt.Errorf("kind is required for compile job %s", compileJob.ID)
			}
			if compileJob.PackageDir == "" {
				return Result{}, fmt.Errorf("package directory is required for compile job %s", compileJob.ID)
			}
			if len(compileJob.Files) == 0 {
				return Result{}, fmt.Errorf("source files are required for compile job %s", compileJob.ID)
			}
			depOnly := compileJob.DepOnly
			standard := compileJob.Standard
			switch compileJob.Kind {
			case "program":
				depOnly = false
				standard = false
			case "imported":
				depOnly = true
				standard = false
			case "stdlib":
				depOnly = true
				standard = true
			}
			loweredUnits = append(loweredUnits, LoweredUnit{
				ID:                compileJob.ID,
				Kind:              compileJob.Kind,
				ImportPath:        compileJob.ImportPath,
				Imports:           append([]string{}, compileJob.Imports...),
				DepOnly:           depOnly,
				ModulePath:        compileJob.ModulePath,
				PackageName:       compileJob.PackageName,
				PackageDir:        compileJob.PackageDir,
				SourceFiles:       append([]string{}, compileJob.Files...),
				LoweredSourcePath: "/working/tinygo-lowered/" + compileJob.ID + ".c",
				Standard:          standard,
			})
		}
	}
	loweredUnitsByID := map[string]LoweredUnit{}
	for _, loweredUnit := range loweredUnits {
		loweredUnitsByID[loweredUnit.ID] = loweredUnit
	}
	loweredUnitsByImportPath := map[string]LoweredUnit{}
	for _, loweredUnit := range loweredUnits {
		if loweredUnit.ImportPath != "" {
			loweredUnitsByImportPath[loweredUnit.ImportPath] = loweredUnit
		}
	}
	runnableBoolLiteralValue := func(name string) (string, bool) {
		switch name {
		case "true":
			return "1", true
		case "false":
			return "0", true
		default:
			return "", false
		}
	}
	type runnablePackage struct {
		UnitID              string
		Kind                string
		PackageName         string
		ImportOrder         []string
		AliasToImportPath   map[string]string
		ImportedPackages    map[string]*runnablePackage
		ConstantOrder       []string
		ConstantDefinitions map[string]string
		ConstantKinds       map[string]string
		ConstantSymbols     map[string]string
		VariableOrder       []string
		VariableDefinitions map[string]string
		VariableKinds       map[string]string
		VariableSymbols     map[string]string
		FunctionOrder       []string
		FunctionDecls       map[string]*ast.FuncDecl
		FunctionReturnsInt  map[string]bool
		FunctionReturnKinds map[string]string
		FunctionParameters  map[string][]string
		FunctionSymbols     map[string]string
	}
	type runnableFunctionInfo struct {
		Symbol     string
		ReturnsInt bool
		ReturnKind string
		Parameters []string
	}
	supportedRunnableImports := map[string]struct{}{
		"bufio":   {},
		"fmt":     {},
		"os":      {},
		"strconv": {},
		"strings": {},
	}
	runnablePackageCache := map[string]*runnablePackage{}
	runnablePackageFailures := map[string]bool{}
	runnablePackageLoading := map[string]bool{}
	var loadRunnablePackage func(LoweredUnit) (*runnablePackage, bool)
	loadRunnablePackage = func(loweredUnit LoweredUnit) (*runnablePackage, bool) {
		if loweredUnit.Kind != "program" && loweredUnit.Kind != "imported" {
			return nil, false
		}
		if cached, ok := runnablePackageCache[loweredUnit.ID]; ok {
			return cached, true
		}
		if runnablePackageFailures[loweredUnit.ID] || runnablePackageLoading[loweredUnit.ID] {
			return nil, false
		}
		runnablePackageLoading[loweredUnit.ID] = true
		defer delete(runnablePackageLoading, loweredUnit.ID)
		symbolID := strings.NewReplacer("-", "_", "/", "_", ".", "_").Replace(loweredUnit.ID)
		pkg := &runnablePackage{
			UnitID:              loweredUnit.ID,
			Kind:                loweredUnit.Kind,
			PackageName:         loweredUnit.PackageName,
			ImportOrder:         make([]string, 0),
			AliasToImportPath:   map[string]string{},
			ImportedPackages:    map[string]*runnablePackage{},
			ConstantOrder:       make([]string, 0),
			ConstantDefinitions: map[string]string{},
			ConstantKinds:       map[string]string{},
			ConstantSymbols:     map[string]string{},
			VariableOrder:       make([]string, 0),
			VariableDefinitions: map[string]string{},
			VariableKinds:       map[string]string{},
			VariableSymbols:     map[string]string{},
			FunctionOrder:       make([]string, 0),
			FunctionDecls:       map[string]*ast.FuncDecl{},
			FunctionReturnsInt:  map[string]bool{},
			FunctionReturnKinds: map[string]string{},
			FunctionParameters:  map[string][]string{},
			FunctionSymbols:     map[string]string{},
		}
		for _, filePath := range loweredUnit.SourceFiles {
			if !strings.HasSuffix(filePath, ".go") {
				runnablePackageFailures[loweredUnit.ID] = true
				return nil, false
			}
			sourceBytes, readErr := os.ReadFile(filePath)
			if readErr != nil {
				runnablePackageFailures[loweredUnit.ID] = true
				return nil, false
			}
			parsedFile, parseErr := parser.ParseFile(token.NewFileSet(), filePath, sourceBytes, 0)
			if parseErr != nil {
				runnablePackageFailures[loweredUnit.ID] = true
				return nil, false
			}
			if parsedFile.Name != nil && parsedFile.Name.Name != "" {
				if pkg.PackageName != "" && pkg.PackageName != parsedFile.Name.Name {
					runnablePackageFailures[loweredUnit.ID] = true
					return nil, false
				}
				pkg.PackageName = parsedFile.Name.Name
			}
			for _, decl := range parsedFile.Decls {
				switch typedDecl := decl.(type) {
				case *ast.GenDecl:
					switch typedDecl.Tok {
					case token.IMPORT:
						for _, spec := range typedDecl.Specs {
							importSpec, ok := spec.(*ast.ImportSpec)
							if !ok || importSpec.Path == nil {
								runnablePackageFailures[loweredUnit.ID] = true
								return nil, false
							}
							importPath, err := strconv.Unquote(importSpec.Path.Value)
							if err != nil {
								runnablePackageFailures[loweredUnit.ID] = true
								return nil, false
							}
							alias := path.Base(importPath)
							if importSpec.Name != nil {
								if importSpec.Name.Name == "_" || importSpec.Name.Name == "." || importSpec.Name.Name == "" {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								alias = importSpec.Name.Name
							}
							if alias == "" {
								runnablePackageFailures[loweredUnit.ID] = true
								return nil, false
							}
							if existingImportPath, ok := pkg.AliasToImportPath[alias]; ok {
								if existingImportPath != importPath {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								continue
							}
							pkg.AliasToImportPath[alias] = importPath
							pkg.ImportOrder = append(pkg.ImportOrder, importPath)
						}
					case token.CONST:
						for _, spec := range typedDecl.Specs {
							valueSpec, ok := spec.(*ast.ValueSpec)
							if !ok || len(valueSpec.Names) == 0 || len(valueSpec.Values) != len(valueSpec.Names) {
								runnablePackageFailures[loweredUnit.ID] = true
								return nil, false
							}
							if valueSpec.Type != nil {
								typeIdent, ok := valueSpec.Type.(*ast.Ident)
								if !ok || (typeIdent.Name != "int" && typeIdent.Name != "string" && typeIdent.Name != "bool") {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
							}
							for index, name := range valueSpec.Names {
								if name == nil || name.Name == "" {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								if _, ok := pkg.ConstantDefinitions[name.Name]; ok {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								if _, ok := pkg.VariableDefinitions[name.Name]; ok {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								constantSymbol := name.Name
								if loweredUnit.Kind != "program" {
									constantSymbol = fmt.Sprintf("tinygo_%s_%s", symbolID, name.Name)
								}
								switch typedValue := valueSpec.Values[index].(type) {
								case *ast.BasicLit:
									switch typedValue.Kind {
									case token.INT:
										pkg.ConstantOrder = append(pkg.ConstantOrder, name.Name)
										pkg.ConstantKinds[name.Name] = "int"
										pkg.ConstantSymbols[name.Name] = constantSymbol
										pkg.ConstantDefinitions[name.Name] = fmt.Sprintf("static const int %s = %s;\n", constantSymbol, typedValue.Value)
									case token.STRING:
										unquotedValue, err := strconv.Unquote(typedValue.Value)
										if err != nil {
											runnablePackageFailures[loweredUnit.ID] = true
											return nil, false
										}
										pkg.ConstantOrder = append(pkg.ConstantOrder, name.Name)
										pkg.ConstantKinds[name.Name] = "string"
										pkg.ConstantSymbols[name.Name] = constantSymbol
										pkg.ConstantDefinitions[name.Name] = fmt.Sprintf("static char *%s = %s;\n", constantSymbol, strconv.Quote(unquotedValue))
									default:
										runnablePackageFailures[loweredUnit.ID] = true
										return nil, false
									}
								case *ast.UnaryExpr:
									if typedValue.Op != token.SUB {
										runnablePackageFailures[loweredUnit.ID] = true
										return nil, false
									}
									basicValue, ok := typedValue.X.(*ast.BasicLit)
									if !ok || basicValue.Kind != token.INT {
										runnablePackageFailures[loweredUnit.ID] = true
										return nil, false
									}
									pkg.ConstantOrder = append(pkg.ConstantOrder, name.Name)
									pkg.ConstantKinds[name.Name] = "int"
									pkg.ConstantSymbols[name.Name] = constantSymbol
									pkg.ConstantDefinitions[name.Name] = fmt.Sprintf("static const int %s = -%s;\n", constantSymbol, basicValue.Value)
								case *ast.Ident:
									boolValue, ok := runnableBoolLiteralValue(typedValue.Name)
									if !ok {
										runnablePackageFailures[loweredUnit.ID] = true
										return nil, false
									}
									pkg.ConstantOrder = append(pkg.ConstantOrder, name.Name)
									pkg.ConstantKinds[name.Name] = "int"
									pkg.ConstantSymbols[name.Name] = constantSymbol
									pkg.ConstantDefinitions[name.Name] = fmt.Sprintf("static const int %s = %s;\n", constantSymbol, boolValue)
								default:
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
							}
						}
					case token.VAR:
						for _, spec := range typedDecl.Specs {
							valueSpec, ok := spec.(*ast.ValueSpec)
							if !ok || len(valueSpec.Names) == 0 || (len(valueSpec.Values) != 0 && len(valueSpec.Values) != len(valueSpec.Names)) {
								runnablePackageFailures[loweredUnit.ID] = true
								return nil, false
							}
							explicitKind := ""
							if valueSpec.Type != nil {
								typeIdent, ok := valueSpec.Type.(*ast.Ident)
								if !ok || (typeIdent.Name != "int" && typeIdent.Name != "string" && typeIdent.Name != "bool") {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								explicitKind = typeIdent.Name
								if explicitKind == "bool" {
									explicitKind = "int"
								}
							}
							for index, name := range valueSpec.Names {
								if name == nil || name.Name == "" {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								if _, ok := pkg.ConstantDefinitions[name.Name]; ok {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								if _, ok := pkg.VariableDefinitions[name.Name]; ok {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								variableSymbol := name.Name
								if loweredUnit.Kind != "program" {
									variableSymbol = fmt.Sprintf("tinygo_%s_%s", symbolID, name.Name)
								}
								variableKind := explicitKind
								variableInitializer := ""
								if len(valueSpec.Values) == 0 {
									switch variableKind {
									case "int":
										variableInitializer = "0"
									case "string":
										variableInitializer = strconv.Quote("")
									default:
										runnablePackageFailures[loweredUnit.ID] = true
										return nil, false
									}
								} else {
									switch typedValue := valueSpec.Values[index].(type) {
									case *ast.BasicLit:
										switch typedValue.Kind {
										case token.INT:
											if variableKind != "" && variableKind != "int" {
												runnablePackageFailures[loweredUnit.ID] = true
												return nil, false
											}
											variableKind = "int"
											variableInitializer = typedValue.Value
										case token.STRING:
											if variableKind != "" && variableKind != "string" {
												runnablePackageFailures[loweredUnit.ID] = true
												return nil, false
											}
											unquotedValue, err := strconv.Unquote(typedValue.Value)
											if err != nil {
												runnablePackageFailures[loweredUnit.ID] = true
												return nil, false
											}
											variableKind = "string"
											variableInitializer = strconv.Quote(unquotedValue)
										default:
											runnablePackageFailures[loweredUnit.ID] = true
											return nil, false
										}
									case *ast.UnaryExpr:
										if typedValue.Op != token.SUB || (variableKind != "" && variableKind != "int") {
											runnablePackageFailures[loweredUnit.ID] = true
											return nil, false
										}
										basicValue, ok := typedValue.X.(*ast.BasicLit)
										if !ok || basicValue.Kind != token.INT {
											runnablePackageFailures[loweredUnit.ID] = true
											return nil, false
										}
										variableKind = "int"
										variableInitializer = "-" + basicValue.Value
									case *ast.Ident:
										boolValue, ok := runnableBoolLiteralValue(typedValue.Name)
										if !ok || (variableKind != "" && variableKind != "int") {
											runnablePackageFailures[loweredUnit.ID] = true
											return nil, false
										}
										variableKind = "int"
										variableInitializer = boolValue
									default:
										runnablePackageFailures[loweredUnit.ID] = true
										return nil, false
									}
								}
								pkg.VariableOrder = append(pkg.VariableOrder, name.Name)
								pkg.VariableKinds[name.Name] = variableKind
								pkg.VariableSymbols[name.Name] = variableSymbol
								switch variableKind {
								case "int":
									pkg.VariableDefinitions[name.Name] = fmt.Sprintf("static int %s = %s;\n", variableSymbol, variableInitializer)
								case "string":
									pkg.VariableDefinitions[name.Name] = fmt.Sprintf("static char *%s = %s;\n", variableSymbol, variableInitializer)
								default:
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
							}
						}
					default:
						runnablePackageFailures[loweredUnit.ID] = true
						return nil, false
					}
				case *ast.FuncDecl:
					if typedDecl.Recv != nil || typedDecl.Type == nil || typedDecl.Name == nil || typedDecl.Name.Name == "" || typedDecl.Body == nil || typedDecl.Type.TypeParams != nil {
						runnablePackageFailures[loweredUnit.ID] = true
						return nil, false
					}
					if _, ok := pkg.FunctionDecls[typedDecl.Name.Name]; ok {
						runnablePackageFailures[loweredUnit.ID] = true
						return nil, false
					}
					functionParameters := make([]string, 0)
					if typedDecl.Type.Params != nil {
						for _, field := range typedDecl.Type.Params.List {
							typeIdent, ok := field.Type.(*ast.Ident)
							if !ok || typeIdent.Name != "int" || len(field.Names) == 0 {
								runnablePackageFailures[loweredUnit.ID] = true
								return nil, false
							}
							for _, name := range field.Names {
								if name == nil || name.Name == "" {
									runnablePackageFailures[loweredUnit.ID] = true
									return nil, false
								}
								functionParameters = append(functionParameters, name.Name)
							}
						}
					}
					functionReturnsInt := false
					functionReturnKind := "void"
					if typedDecl.Type.Results != nil {
						if len(typedDecl.Type.Results.List) != 1 {
							runnablePackageFailures[loweredUnit.ID] = true
							return nil, false
						}
						resultField := typedDecl.Type.Results.List[0]
						typeIdent, ok := resultField.Type.(*ast.Ident)
						if !ok || len(resultField.Names) > 1 || (typeIdent.Name != "int" && typeIdent.Name != "string") {
							runnablePackageFailures[loweredUnit.ID] = true
							return nil, false
						}
						functionReturnKind = typeIdent.Name
						functionReturnsInt = functionReturnKind == "int"
					}
					functionSymbol := typedDecl.Name.Name
					if loweredUnit.Kind != "program" {
						functionSymbol = fmt.Sprintf("tinygo_%s_%s", symbolID, typedDecl.Name.Name)
					}
					pkg.FunctionOrder = append(pkg.FunctionOrder, typedDecl.Name.Name)
					pkg.FunctionDecls[typedDecl.Name.Name] = typedDecl
					pkg.FunctionReturnsInt[typedDecl.Name.Name] = functionReturnsInt
					pkg.FunctionReturnKinds[typedDecl.Name.Name] = functionReturnKind
					pkg.FunctionParameters[typedDecl.Name.Name] = append([]string{}, functionParameters...)
					pkg.FunctionSymbols[typedDecl.Name.Name] = functionSymbol
				default:
					runnablePackageFailures[loweredUnit.ID] = true
					return nil, false
				}
			}
		}
		if loweredUnit.Kind == "program" {
			if _, ok := pkg.FunctionSymbols["main"]; !ok {
				runnablePackageFailures[loweredUnit.ID] = true
				return nil, false
			}
			if pkg.FunctionReturnKinds["main"] != "void" || len(pkg.FunctionParameters["main"]) != 0 {
				runnablePackageFailures[loweredUnit.ID] = true
				return nil, false
			}
		}
		for _, importPath := range pkg.ImportOrder {
			if _, ok := supportedRunnableImports[importPath]; ok {
				continue
			}
			importedUnit, ok := loweredUnitsByImportPath[importPath]
			if !ok || importedUnit.Kind != "imported" {
				runnablePackageFailures[loweredUnit.ID] = true
				return nil, false
			}
			importedPackage, ok := loadRunnablePackage(importedUnit)
			if !ok {
				runnablePackageFailures[loweredUnit.ID] = true
				return nil, false
			}
			pkg.ImportedPackages[importPath] = importedPackage
		}
		runnablePackageCache[loweredUnit.ID] = pkg
		return pkg, true
	}

	resolveRunnableImportedSelector := func(pkg *runnablePackage, expression ast.Expr) (string, string, bool) {
		selectorExpression, ok := expression.(*ast.SelectorExpr)
		if !ok {
			return "", "", false
		}
		packageIdent, ok := selectorExpression.X.(*ast.Ident)
		if !ok || selectorExpression.Sel == nil {
			return "", "", false
		}
		importPath, ok := pkg.AliasToImportPath[packageIdent.Name]
		if !ok {
			return "", "", false
		}
		return importPath, selectorExpression.Sel.Name, true
	}
	formatRunnableParameterDecls := func(parameterNames []string) string {
		if len(parameterNames) == 0 {
			return "void"
		}
		parameterDecls := make([]string, 0, len(parameterNames))
		for _, parameterName := range parameterNames {
			parameterDecls = append(parameterDecls, fmt.Sprintf("int %s", parameterName))
		}
		return strings.Join(parameterDecls, ", ")
	}
	runnableReturnCType := func(returnKind string) (string, bool) {
		switch returnKind {
		case "void":
			return "void", true
		case "int":
			return "int", true
		case "string":
			return "char*", true
		default:
			return "", false
		}
	}
	runnableStringCompareExpression := func(leftValue string, rightValue string, op token.Token) (string, bool) {
		switch op {
		case token.EQL:
			return fmt.Sprintf("(tinygo_runtime_string_equal(%s, %s) != 0)", leftValue, rightValue), true
		case token.NEQ:
			return fmt.Sprintf("(tinygo_runtime_string_equal(%s, %s) == 0)", leftValue, rightValue), true
		default:
			return "", false
		}
	}
	runnableTaggedCaseCondition := func(tagValue string, tagKind string, caseValue string) (string, bool) {
		switch tagKind {
		case "int":
			return fmt.Sprintf("(%s == %s)", tagValue, caseValue), true
		case "string":
			return fmt.Sprintf("(tinygo_runtime_string_equal(%s, %s) != 0)", tagValue, caseValue), true
		default:
			return "", false
		}
	}
	runnableCompoundAssignToken := func(op token.Token) (string, bool) {
		switch op {
		case token.ADD_ASSIGN, token.SUB_ASSIGN, token.MUL_ASSIGN, token.QUO_ASSIGN, token.REM_ASSIGN:
			return op.String(), true
		default:
			return "", false
		}
	}
	appendRunnablePrintArgument := func(translatedStatements *strings.Builder, translatedArgument string, argumentKind string, byteLength int, newline int) bool {
		switch argumentKind {
		case "string":
			if byteLength > 0 {
				translatedStatements.WriteString(fmt.Sprintf("\ttinygo_runtime_print_literal(%s, %du, %d);\n", translatedArgument, byteLength, newline))
				return true
			}
			translatedStatements.WriteString(fmt.Sprintf("\ttinygo_runtime_print_string(%s, %d);\n", translatedArgument, newline))
			return true
		case "int":
			translatedStatements.WriteString(fmt.Sprintf("\ttinygo_runtime_print_i32(%s, %d);\n", translatedArgument, newline))
			return true
		default:
			return false
		}
	}
	runnablePrintfTempCounter := 0
	appendRunnablePrintf := func(translatedStatements *strings.Builder, formatArgument ast.Expr, args []ast.Expr, locals map[string]string, translateExpression func(ast.Expr, map[string]string) (string, string, int, bool)) bool {
		formatLiteral, ok := formatArgument.(*ast.BasicLit)
		if !ok || formatLiteral.Kind != token.STRING {
			return false
		}
		formatValue, err := strconv.Unquote(formatLiteral.Value)
		if err != nil {
			return false
		}
		var declarations strings.Builder
		var outputs strings.Builder
		appendLiteral := func(value string) {
			if value != "" {
				outputs.WriteString(fmt.Sprintf("\ttinygo_runtime_print_literal(%s, %du, 0);\n", strconv.Quote(value), len([]byte(value))))
			}
		}
		argumentIndex := 0
		segmentStart := 0
		for index := 0; index < len(formatValue); index++ {
			if formatValue[index] != '%' {
				continue
			}
			if index+1 >= len(formatValue) {
				return false
			}
			verb := formatValue[index+1]
			if verb == '%' {
				appendLiteral(formatValue[segmentStart:index] + "%")
				segmentStart = index + 2
				index++
				continue
			}
			if verb != 'd' && verb != 's' {
				return false
			}
			if argumentIndex >= len(args) {
				return false
			}
			appendLiteral(formatValue[segmentStart:index])
			translatedArgument, argumentKind, byteLength, argumentOK := translateExpression(args[argumentIndex], locals)
			if !argumentOK {
				return false
			}
			if verb == 'd' && argumentKind != "int" {
				return false
			}
			if verb == 's' && argumentKind != "string" {
				return false
			}
			tempName := fmt.Sprintf("tinygo_printf_arg_%03d", runnablePrintfTempCounter)
			runnablePrintfTempCounter++
			switch argumentKind {
			case "int":
				declarations.WriteString(fmt.Sprintf("\tint %s = %s;\n", tempName, translatedArgument))
			case "string":
				declarations.WriteString(fmt.Sprintf("\tchar *%s = %s;\n", tempName, translatedArgument))
				byteLength = 0
			default:
				return false
			}
			if !appendRunnablePrintArgument(&outputs, tempName, argumentKind, byteLength, 0) {
				return false
			}
			argumentIndex++
			segmentStart = index + 2
			index++
		}
		appendLiteral(formatValue[segmentStart:])
		if argumentIndex != len(args) {
			return false
		}
		translatedStatements.WriteString(declarations.String())
		translatedStatements.WriteString(outputs.String())
		return true
	}
	translateRunnableLocalScalarDecl := func(statement *ast.DeclStmt, locals map[string]string, translateExpression func(ast.Expr, map[string]string) (string, string, int, bool)) (string, bool) {
		genDecl, ok := statement.Decl.(*ast.GenDecl)
		if !ok || (genDecl.Tok != token.VAR && genDecl.Tok != token.CONST) {
			return "", false
		}
		constDecl := genDecl.Tok == token.CONST
		var translatedStatements strings.Builder
		for _, spec := range genDecl.Specs {
			valueSpec, ok := spec.(*ast.ValueSpec)
			if !ok || len(valueSpec.Names) == 0 {
				return "", false
			}
			if constDecl && len(valueSpec.Values) != len(valueSpec.Names) {
				return "", false
			}
			if !constDecl && len(valueSpec.Values) != 0 && len(valueSpec.Values) != len(valueSpec.Names) {
				return "", false
			}
			explicitKind := ""
			if valueSpec.Type != nil {
				typeIdent, ok := valueSpec.Type.(*ast.Ident)
				if !ok || (typeIdent.Name != "int" && typeIdent.Name != "string" && typeIdent.Name != "bool") {
					return "", false
				}
				explicitKind = typeIdent.Name
				if explicitKind == "bool" {
					explicitKind = "int"
				}
			}
			for index, name := range valueSpec.Names {
				if name == nil || name.Name == "" || name.Name == "_" {
					return "", false
				}
				if _, exists := locals[name.Name]; exists {
					return "", false
				}
				variableKind := explicitKind
				variableInitializer := ""
				if len(valueSpec.Values) == 0 {
					switch variableKind {
					case "int":
						variableInitializer = "0"
					case "string":
						variableInitializer = strconv.Quote("")
					default:
						return "", false
					}
				} else {
					translatedValue, translatedKind, _, translatedOK := translateExpression(valueSpec.Values[index], locals)
					if !translatedOK || translatedKind == "error" {
						return "", false
					}
					if variableKind != "" && variableKind != translatedKind {
						return "", false
					}
					variableKind = translatedKind
					variableInitializer = translatedValue
				}
				switch variableKind {
				case "int":
					locals[name.Name] = "int"
					if constDecl {
						translatedStatements.WriteString(fmt.Sprintf("\tconst int %s = %s;\n", name.Name, variableInitializer))
					} else {
						translatedStatements.WriteString(fmt.Sprintf("\tint %s = %s;\n", name.Name, variableInitializer))
					}
				case "string":
					locals[name.Name] = "string"
					translatedStatements.WriteString(fmt.Sprintf("\tchar *%s = %s;\n", name.Name, variableInitializer))
				default:
					return "", false
				}
			}
		}
		return translatedStatements.String(), true
	}
	cloneRunnableLocals := func(locals map[string]string) map[string]string {
		clonedLocals := map[string]string{}
		for name, kind := range locals {
			clonedLocals[name] = kind
		}
		return clonedLocals
	}
	translateRunnableInitStatement := func(statement ast.Stmt, locals map[string]string, translateExpression func(ast.Expr, map[string]string) (string, string, int, bool)) (string, bool) {
		switch typedStatement := statement.(type) {
		case *ast.DeclStmt:
			return translateRunnableLocalScalarDecl(typedStatement, locals, translateExpression)
		case *ast.AssignStmt:
			if len(typedStatement.Lhs) != 1 || len(typedStatement.Rhs) != 1 || typedStatement.Tok != token.DEFINE {
				return "", false
			}
			leftName, ok := typedStatement.Lhs[0].(*ast.Ident)
			if !ok || leftName.Name == "" || leftName.Name == "_" {
				return "", false
			}
			if _, exists := locals[leftName.Name]; exists {
				return "", false
			}
			translatedValue, translatedKind, _, translatedOK := translateExpression(typedStatement.Rhs[0], locals)
			if !translatedOK || (translatedKind != "int" && translatedKind != "string" && translatedKind != "error") {
				return "", false
			}
			locals[leftName.Name] = translatedKind
			switch translatedKind {
			case "int", "error":
				return fmt.Sprintf("\tint %s = %s;\n", leftName.Name, translatedValue), true
			case "string":
				return fmt.Sprintf("\tchar *%s = %s;\n", leftName.Name, translatedValue), true
			default:
				return "", false
			}
		default:
			return "", false
		}
	}
	var translateRunnableExpression func(*runnablePackage, ast.Expr, map[string]string) (string, string, int, bool)
	translateRunnableExpression = func(pkg *runnablePackage, expression ast.Expr, locals map[string]string) (string, string, int, bool) {
		switch typedExpression := expression.(type) {
		case *ast.BasicLit:
			if typedExpression.Kind == token.INT {
				return typedExpression.Value, "int", 0, true
			}
			if typedExpression.Kind == token.STRING {
				unquotedValue, err := strconv.Unquote(typedExpression.Value)
				if err != nil {
					return "", "", 0, false
				}
				return strconv.Quote(unquotedValue), "string", len([]byte(unquotedValue)), true
			}
			return "", "", 0, false
		case *ast.Ident:
			if boolValue, ok := runnableBoolLiteralValue(typedExpression.Name); ok {
				return boolValue, "int", 0, true
			}
			if localKind, ok := locals[typedExpression.Name]; ok {
				return typedExpression.Name, localKind, 0, true
			}
			if constantSymbol, ok := pkg.ConstantSymbols[typedExpression.Name]; ok {
				constantKind, ok := pkg.ConstantKinds[typedExpression.Name]
				if !ok {
					return "", "", 0, false
				}
				return constantSymbol, constantKind, 0, true
			}
			if variableSymbol, ok := pkg.VariableSymbols[typedExpression.Name]; ok {
				variableKind, ok := pkg.VariableKinds[typedExpression.Name]
				if !ok {
					return "", "", 0, false
				}
				return variableSymbol, variableKind, 0, true
			}
			if typedExpression.Name == "nil" {
				return "0", "nil", 0, true
			}
			return "", "", 0, false
		case *ast.BinaryExpr:
			leftValue, leftKind, _, leftOK := translateRunnableExpression(pkg, typedExpression.X, locals)
			rightValue, rightKind, _, rightOK := translateRunnableExpression(pkg, typedExpression.Y, locals)
			if !leftOK || !rightOK {
				return "", "", 0, false
			}
			switch typedExpression.Op {
			case token.ADD, token.SUB, token.MUL, token.QUO, token.REM:
				if leftKind != "int" || rightKind != "int" {
					return "", "", 0, false
				}
				return fmt.Sprintf("(%s %s %s)", leftValue, typedExpression.Op.String(), rightValue), "int", 0, true
			case token.EQL, token.NEQ:
				if leftKind == "string" || rightKind == "string" {
					if leftKind != "string" || rightKind != "string" {
						return "", "", 0, false
					}
					translatedComparison, comparisonOK := runnableStringCompareExpression(leftValue, rightValue, typedExpression.Op)
					if !comparisonOK {
						return "", "", 0, false
					}
					return translatedComparison, "int", 0, true
				}
				leftComparable := leftKind == "int" || leftKind == "error" || leftKind == "nil"
				rightComparable := rightKind == "int" || rightKind == "error" || rightKind == "nil"
				if !leftComparable || !rightComparable {
					return "", "", 0, false
				}
				return fmt.Sprintf("(%s %s %s)", leftValue, typedExpression.Op.String(), rightValue), "int", 0, true
			case token.LSS, token.GTR, token.LEQ, token.GEQ:
				leftComparable := leftKind == "int" || leftKind == "error" || leftKind == "nil"
				rightComparable := rightKind == "int" || rightKind == "error" || rightKind == "nil"
				if !leftComparable || !rightComparable {
					return "", "", 0, false
				}
				return fmt.Sprintf("(%s %s %s)", leftValue, typedExpression.Op.String(), rightValue), "int", 0, true
			case token.LAND, token.LOR:
				if leftKind != "int" || rightKind != "int" {
					return "", "", 0, false
				}
				return fmt.Sprintf("(%s %s %s)", leftValue, typedExpression.Op.String(), rightValue), "int", 0, true
			default:
				return "", "", 0, false
			}
		case *ast.CallExpr:
			if importPath, selectorName, ok := resolveRunnableImportedSelector(pkg, typedExpression.Fun); ok {
				if importPath == "strings" && selectorName == "TrimSpace" && len(typedExpression.Args) == 1 {
					translatedArgument, argumentKind, _, argumentOK := translateRunnableExpression(pkg, typedExpression.Args[0], locals)
					if !argumentOK || argumentKind != "string" {
						return "", "", 0, false
					}
					return fmt.Sprintf("tinygo_runtime_trim_space(%s)", translatedArgument), "string", 0, true
				}
				importedPackage, ok := pkg.ImportedPackages[importPath]
				if !ok || !ast.IsExported(selectorName) {
					return "", "", 0, false
				}
				returnKind, ok := importedPackage.FunctionReturnKinds[selectorName]
				if !ok || (returnKind != "int" && returnKind != "string") {
					return "", "", 0, false
				}
				parameterNames := importedPackage.FunctionParameters[selectorName]
				if len(parameterNames) != len(typedExpression.Args) {
					return "", "", 0, false
				}
				translatedArgs := make([]string, 0, len(typedExpression.Args))
				for _, argument := range typedExpression.Args {
					translatedArgument, argumentKind, _, argumentOK := translateRunnableExpression(pkg, argument, locals)
					if !argumentOK || argumentKind != "int" {
						return "", "", 0, false
					}
					translatedArgs = append(translatedArgs, translatedArgument)
				}
				return fmt.Sprintf("%s(%s)", importedPackage.FunctionSymbols[selectorName], strings.Join(translatedArgs, ", ")), returnKind, 0, true
			}
			functionIdent, ok := typedExpression.Fun.(*ast.Ident)
			if !ok {
				return "", "", 0, false
			}
			functionName := functionIdent.Name
			if functionName == "len" && len(typedExpression.Args) == 1 {
				translatedArgument, argumentKind, byteLength, argumentOK := translateRunnableExpression(pkg, typedExpression.Args[0], locals)
				if !argumentOK || argumentKind != "string" {
					return "", "", 0, false
				}
				if byteLength > 0 {
					return strconv.Itoa(byteLength), "int", 0, true
				}
				return fmt.Sprintf("tinygo_runtime_string_len(%s)", translatedArgument), "int", 0, true
			}
			returnKind, ok := pkg.FunctionReturnKinds[functionName]
			if !ok || (returnKind != "int" && returnKind != "string") {
				return "", "", 0, false
			}
			parameterNames := pkg.FunctionParameters[functionName]
			if len(parameterNames) != len(typedExpression.Args) {
				return "", "", 0, false
			}
			translatedArgs := make([]string, 0, len(typedExpression.Args))
			for _, argument := range typedExpression.Args {
				translatedArgument, argumentKind, _, argumentOK := translateRunnableExpression(pkg, argument, locals)
				if !argumentOK || argumentKind != "int" {
					return "", "", 0, false
				}
				translatedArgs = append(translatedArgs, translatedArgument)
			}
			return fmt.Sprintf("%s(%s)", pkg.FunctionSymbols[functionName], strings.Join(translatedArgs, ", ")), returnKind, 0, true
		case *ast.ParenExpr:
			return translateRunnableExpression(pkg, typedExpression.X, locals)
		case *ast.UnaryExpr:
			translatedValue, translatedKind, _, translatedOK := translateRunnableExpression(pkg, typedExpression.X, locals)
			if !translatedOK || translatedKind != "int" {
				return "", "", 0, false
			}
			switch typedExpression.Op {
			case token.SUB, token.ADD:
				return fmt.Sprintf("(%s%s)", typedExpression.Op.String(), translatedValue), "int", 0, true
			case token.NOT:
				return fmt.Sprintf("(!%s)", translatedValue), "int", 0, true
			default:
				return "", "", 0, false
			}
		default:
			return "", "", 0, false
		}
	}
	var translateRunnableStatementList func(*runnablePackage, []ast.Stmt, map[string]string, string, int) (string, bool)
	translateRunnableStatementList = func(pkg *runnablePackage, statements []ast.Stmt, locals map[string]string, functionReturnKind string, loopDepth int) (string, bool) {
		var translatedStatements strings.Builder
		for _, statement := range statements {
			switch typedStatement := statement.(type) {
			case *ast.ExprStmt:
				callExpression, ok := typedStatement.X.(*ast.CallExpr)
				if !ok {
					return "", false
				}
				callIdent, callIdentOK := callExpression.Fun.(*ast.Ident)
				if callIdentOK && (callIdent.Name == "print" || callIdent.Name == "println") {
					for argumentIndex, argument := range callExpression.Args {
						translatedArgument, argumentKind, byteLength, argumentOK := translateRunnableExpression(pkg, argument, locals)
						if !argumentOK {
							return "", false
						}
						newline := 0
						if callIdent.Name == "println" && argumentIndex == len(callExpression.Args)-1 {
							newline = 1
						}
						if !appendRunnablePrintArgument(&translatedStatements, translatedArgument, argumentKind, byteLength, newline) {
							return "", false
						}
					}
					if callIdent.Name == "println" && len(callExpression.Args) == 0 {
						translatedStatements.WriteString("\ttinygo_runtime_print_newline();\n")
					}
					continue
				}
				if importPath, selectorName, ok := resolveRunnableImportedSelector(pkg, callExpression.Fun); ok {
					if importPath == "fmt" && (selectorName == "Print" || selectorName == "Println") {
						for argumentIndex, argument := range callExpression.Args {
							translatedArgument, argumentKind, byteLength, argumentOK := translateRunnableExpression(pkg, argument, locals)
							if !argumentOK {
								return "", false
							}
							newline := 0
							if selectorName == "Println" && argumentIndex == len(callExpression.Args)-1 {
								newline = 1
							}
							if !appendRunnablePrintArgument(&translatedStatements, translatedArgument, argumentKind, byteLength, newline) {
								return "", false
							}
						}
						if selectorName == "Println" && len(callExpression.Args) == 0 {
							translatedStatements.WriteString("\ttinygo_runtime_print_newline();\n")
						}
						continue
					}
					if importPath == "fmt" && selectorName == "Printf" && len(callExpression.Args) >= 1 {
						if !appendRunnablePrintf(&translatedStatements, callExpression.Args[0], callExpression.Args[1:], locals, func(expression ast.Expr, locals map[string]string) (string, string, int, bool) {
							return translateRunnableExpression(pkg, expression, locals)
						}) {
							return "", false
						}
						continue
					}
					importedPackage, ok := pkg.ImportedPackages[importPath]
					if !ok || !ast.IsExported(selectorName) {
						return "", false
					}
					_, ok = importedPackage.FunctionReturnsInt[selectorName]
					if !ok {
						return "", false
					}
					parameterNames := importedPackage.FunctionParameters[selectorName]
					if len(parameterNames) != len(callExpression.Args) {
						return "", false
					}
					translatedArgs := make([]string, 0, len(callExpression.Args))
					for _, argument := range callExpression.Args {
						translatedArgument, argumentKind, _, argumentOK := translateRunnableExpression(pkg, argument, locals)
						if !argumentOK || argumentKind != "int" {
							return "", false
						}
						translatedArgs = append(translatedArgs, translatedArgument)
					}
					translatedStatements.WriteString(fmt.Sprintf("\t%s(%s);\n", importedPackage.FunctionSymbols[selectorName], strings.Join(translatedArgs, ", ")))
					continue
				}
				if !callIdentOK {
					return "", false
				}
				returnsInt, ok := pkg.FunctionReturnsInt[callIdent.Name]
				if !ok {
					return "", false
				}
				if returnsInt {
					translatedCall, argumentKind, _, callOK := translateRunnableExpression(pkg, callExpression, locals)
					if !callOK || argumentKind != "int" {
						return "", false
					}
					translatedStatements.WriteString(fmt.Sprintf("\t%s;\n", translatedCall))
					continue
				}
				parameterNames := pkg.FunctionParameters[callIdent.Name]
				if len(parameterNames) != len(callExpression.Args) {
					return "", false
				}
				translatedArgs := make([]string, 0, len(callExpression.Args))
				for _, argument := range callExpression.Args {
					translatedArgument, argumentKind, _, argumentOK := translateRunnableExpression(pkg, argument, locals)
					if !argumentOK || argumentKind != "int" {
						return "", false
					}
					translatedArgs = append(translatedArgs, translatedArgument)
				}
				translatedStatements.WriteString(fmt.Sprintf("\t%s(%s);\n", pkg.FunctionSymbols[callIdent.Name], strings.Join(translatedArgs, ", ")))
			case *ast.DeclStmt:
				translatedDecl, declOK := translateRunnableLocalScalarDecl(typedStatement, locals, func(expression ast.Expr, locals map[string]string) (string, string, int, bool) {
					return translateRunnableExpression(pkg, expression, locals)
				})
				if !declOK {
					return "", false
				}
				translatedStatements.WriteString(translatedDecl)
			case *ast.AssignStmt:
				if len(typedStatement.Lhs) != 1 || len(typedStatement.Rhs) != 1 {
					return "", false
				}
				leftName, ok := typedStatement.Lhs[0].(*ast.Ident)
				if !ok || leftName.Name == "" {
					return "", false
				}
				translatedValue, translatedKind, _, translatedOK := translateRunnableExpression(pkg, typedStatement.Rhs[0], locals)
				if !translatedOK {
					return "", false
				}
				if typedStatement.Tok == token.DEFINE {
					if leftName.Name == "_" {
						return "", false
					}
					if translatedKind != "int" && translatedKind != "string" && translatedKind != "error" {
						return "", false
					}
					locals[leftName.Name] = translatedKind
					switch translatedKind {
					case "int", "error":
						translatedStatements.WriteString(fmt.Sprintf("\tint %s = %s;\n", leftName.Name, translatedValue))
					case "string":
						translatedStatements.WriteString(fmt.Sprintf("\tchar *%s = %s;\n", leftName.Name, translatedValue))
					default:
						return "", false
					}
					continue
				}
				compoundAssignToken, compoundAssignOK := runnableCompoundAssignToken(typedStatement.Tok)
				if typedStatement.Tok != token.ASSIGN && !compoundAssignOK {
					return "", false
				}
				if leftName.Name == "_" {
					continue
				}
				localKind, ok := locals[leftName.Name]
				leftSymbol := leftName.Name
				if !ok {
					variableSymbol, variableOK := pkg.VariableSymbols[leftName.Name]
					if !variableOK {
						return "", false
					}
					localKind, ok = pkg.VariableKinds[leftName.Name]
					if !ok {
						return "", false
					}
					leftSymbol = variableSymbol
				}
				if localKind != translatedKind && !(localKind == "error" && translatedKind == "int") {
					return "", false
				}
				if compoundAssignOK {
					if localKind != "int" || translatedKind != "int" {
						return "", false
					}
					translatedStatements.WriteString(fmt.Sprintf("\t%s %s %s;\n", leftSymbol, compoundAssignToken, translatedValue))
					continue
				}
				translatedStatements.WriteString(fmt.Sprintf("\t%s = %s;\n", leftSymbol, translatedValue))
			case *ast.IncDecStmt:
				ident, ok := typedStatement.X.(*ast.Ident)
				if !ok || ident.Name == "" {
					return "", false
				}
				localKind, ok := locals[ident.Name]
				targetSymbol := ident.Name
				if !ok {
					variableSymbol, variableOK := pkg.VariableSymbols[ident.Name]
					if !variableOK {
						return "", false
					}
					localKind, ok = pkg.VariableKinds[ident.Name]
					if !ok {
						return "", false
					}
					targetSymbol = variableSymbol
				}
				if localKind != "int" {
					return "", false
				}
				switch typedStatement.Tok {
				case token.INC:
					translatedStatements.WriteString(fmt.Sprintf("\t%s += 1;\n", targetSymbol))
				case token.DEC:
					translatedStatements.WriteString(fmt.Sprintf("\t%s -= 1;\n", targetSymbol))
				default:
					return "", false
				}
			case *ast.BranchStmt:
				if typedStatement.Label != nil || loopDepth == 0 {
					return "", false
				}
				switch typedStatement.Tok {
				case token.BREAK:
					translatedStatements.WriteString("\tbreak;\n")
				case token.CONTINUE:
					translatedStatements.WriteString("\tcontinue;\n")
				default:
					return "", false
				}
			case *ast.IfStmt:
				ifLocals := locals
				translatedInit := ""
				if typedStatement.Init != nil {
					ifLocals = cloneRunnableLocals(locals)
					var initOK bool
					translatedInit, initOK = translateRunnableInitStatement(typedStatement.Init, ifLocals, func(expression ast.Expr, locals map[string]string) (string, string, int, bool) {
						return translateRunnableExpression(pkg, expression, locals)
					})
					if !initOK {
						return "", false
					}
				}
				translatedCondition, conditionKind, _, conditionOK := translateRunnableExpression(pkg, typedStatement.Cond, ifLocals)
				if !conditionOK || conditionKind != "int" {
					return "", false
				}
				translatedBody, bodyOK := translateRunnableStatementList(pkg, typedStatement.Body.List, ifLocals, functionReturnKind, loopDepth)
				if !bodyOK {
					return "", false
				}
				if typedStatement.Init != nil {
					translatedStatements.WriteString("\t{\n")
					translatedStatements.WriteString(translatedInit)
				}
				translatedStatements.WriteString(fmt.Sprintf("\tif (%s) {\n%s\t}\n", translatedCondition, translatedBody))
				if typedStatement.Else != nil {
					switch typedElse := typedStatement.Else.(type) {
					case *ast.BlockStmt:
						translatedElse, elseOK := translateRunnableStatementList(pkg, typedElse.List, ifLocals, functionReturnKind, loopDepth)
						if !elseOK {
							return "", false
						}
						translatedStatements.WriteString(fmt.Sprintf("\telse {\n%s\t}\n", translatedElse))
					case *ast.IfStmt:
						translatedElse, elseOK := translateRunnableStatementList(pkg, []ast.Stmt{typedElse}, ifLocals, functionReturnKind, loopDepth)
						if !elseOK {
							return "", false
						}
						trimmedElse := strings.TrimPrefix(translatedElse, "\t")
						translatedStatements.WriteString("\telse ")
						translatedStatements.WriteString(trimmedElse)
					default:
						return "", false
					}
				}
				if typedStatement.Init != nil {
					translatedStatements.WriteString("\t}\n")
				}
			case *ast.ForStmt:
				loopLocals := map[string]string{}
				for name, kind := range locals {
					loopLocals[name] = kind
				}
				initFragment := ""
				if typedStatement.Init != nil {
					initAssign, ok := typedStatement.Init.(*ast.AssignStmt)
					if !ok || len(initAssign.Lhs) != 1 || len(initAssign.Rhs) != 1 {
						return "", false
					}
					leftName, ok := initAssign.Lhs[0].(*ast.Ident)
					if !ok || leftName.Name == "" || leftName.Name == "_" {
						return "", false
					}
					translatedValue, translatedKind, _, translatedOK := translateRunnableExpression(pkg, initAssign.Rhs[0], loopLocals)
					if !translatedOK || translatedKind != "int" {
						return "", false
					}
					switch initAssign.Tok {
					case token.DEFINE:
						if _, exists := loopLocals[leftName.Name]; exists {
							return "", false
						}
						loopLocals[leftName.Name] = "int"
						initFragment = fmt.Sprintf("int %s = %s", leftName.Name, translatedValue)
					case token.ASSIGN:
						localKind, ok := loopLocals[leftName.Name]
						if !ok || localKind != "int" {
							return "", false
						}
						initFragment = fmt.Sprintf("%s = %s", leftName.Name, translatedValue)
					default:
						return "", false
					}
				}
				conditionFragment := "1"
				if typedStatement.Cond != nil {
					translatedCondition, conditionKind, _, conditionOK := translateRunnableExpression(pkg, typedStatement.Cond, loopLocals)
					if !conditionOK || conditionKind != "int" {
						return "", false
					}
					conditionFragment = translatedCondition
				}
				postFragment := ""
				if typedStatement.Post != nil {
					switch postStatement := typedStatement.Post.(type) {
					case *ast.IncDecStmt:
						postIdent, ok := postStatement.X.(*ast.Ident)
						if !ok || postIdent.Name == "" {
							return "", false
						}
						postKind, ok := loopLocals[postIdent.Name]
						if !ok || postKind != "int" {
							return "", false
						}
						switch postStatement.Tok {
						case token.INC:
							postFragment = fmt.Sprintf("%s += 1", postIdent.Name)
						case token.DEC:
							postFragment = fmt.Sprintf("%s -= 1", postIdent.Name)
						default:
							return "", false
						}
					case *ast.AssignStmt:
						compoundAssignToken, compoundAssignOK := runnableCompoundAssignToken(postStatement.Tok)
						if len(postStatement.Lhs) != 1 || len(postStatement.Rhs) != 1 || (postStatement.Tok != token.ASSIGN && !compoundAssignOK) {
							return "", false
						}
						postName, ok := postStatement.Lhs[0].(*ast.Ident)
						if !ok || postName.Name == "" || postName.Name == "_" {
							return "", false
						}
						postKind, ok := loopLocals[postName.Name]
						if !ok || postKind != "int" {
							return "", false
						}
						translatedValue, translatedKind, _, translatedOK := translateRunnableExpression(pkg, postStatement.Rhs[0], loopLocals)
						if !translatedOK || translatedKind != "int" {
							return "", false
						}
						if compoundAssignOK {
							postFragment = fmt.Sprintf("%s %s %s", postName.Name, compoundAssignToken, translatedValue)
							break
						}
						postFragment = fmt.Sprintf("%s = %s", postName.Name, translatedValue)
					default:
						return "", false
					}
				}
				translatedBody, bodyOK := translateRunnableStatementList(pkg, typedStatement.Body.List, loopLocals, functionReturnKind, loopDepth+1)
				if !bodyOK {
					return "", false
				}
				translatedStatements.WriteString(fmt.Sprintf("\tfor (%s; %s; %s) {\n%s\t}\n", initFragment, conditionFragment, postFragment, translatedBody))
			case *ast.SwitchStmt:
				if typedStatement.Body == nil {
					return "", false
				}
				switchLocals := locals
				translatedInit := ""
				if typedStatement.Init != nil {
					switchLocals = cloneRunnableLocals(locals)
					var initOK bool
					translatedInit, initOK = translateRunnableInitStatement(typedStatement.Init, switchLocals, func(expression ast.Expr, locals map[string]string) (string, string, int, bool) {
						return translateRunnableExpression(pkg, expression, locals)
					})
					if !initOK {
						return "", false
					}
				}
				tagValue := ""
				tagKind := "int"
				if typedStatement.Tag != nil {
					translatedTag, translatedTagKind, _, tagOK := translateRunnableExpression(pkg, typedStatement.Tag, switchLocals)
					if !tagOK || (translatedTagKind != "int" && translatedTagKind != "string") {
						return "", false
					}
					tagValue = translatedTag
					tagKind = translatedTagKind
				}
				type translatedCaseClause struct {
					condition string
					body      string
				}
				translatedCases := make([]translatedCaseClause, 0, len(typedStatement.Body.List))
				defaultBody := ""
				for _, statement := range typedStatement.Body.List {
					caseClause, ok := statement.(*ast.CaseClause)
					if !ok {
						return "", false
					}
					caseLocals := map[string]string{}
					for name, kind := range switchLocals {
						caseLocals[name] = kind
					}
					translatedBody, bodyOK := translateRunnableStatementList(pkg, caseClause.Body, caseLocals, functionReturnKind, loopDepth)
					if !bodyOK {
						return "", false
					}
					if len(caseClause.List) == 0 {
						if defaultBody != "" {
							return "", false
						}
						defaultBody = translatedBody
						continue
					}
					conditions := make([]string, 0, len(caseClause.List))
					for _, caseExpression := range caseClause.List {
						translatedCase, translatedCaseKind, _, caseOK := translateRunnableExpression(pkg, caseExpression, switchLocals)
						if !caseOK || translatedCaseKind != tagKind {
							return "", false
						}
						if typedStatement.Tag == nil {
							if translatedCaseKind != "int" {
								return "", false
							}
							conditions = append(conditions, fmt.Sprintf("(%s)", translatedCase))
							continue
						}
						translatedCondition, conditionOK := runnableTaggedCaseCondition(tagValue, tagKind, translatedCase)
						if !conditionOK {
							return "", false
						}
						conditions = append(conditions, translatedCondition)
					}
					if len(conditions) == 0 {
						return "", false
					}
					translatedCases = append(translatedCases, translatedCaseClause{
						condition: strings.Join(conditions, " || "),
						body:      translatedBody,
					})
				}
				if typedStatement.Init != nil {
					translatedStatements.WriteString("\t{\n")
					translatedStatements.WriteString(translatedInit)
				}
				for caseIndex, translatedCase := range translatedCases {
					if caseIndex == 0 {
						translatedStatements.WriteString(fmt.Sprintf("\tif (%s) {\n%s\t}\n", translatedCase.condition, translatedCase.body))
						continue
					}
					translatedStatements.WriteString(fmt.Sprintf("\telse if (%s) {\n%s\t}\n", translatedCase.condition, translatedCase.body))
				}
				if defaultBody != "" {
					if len(translatedCases) == 0 {
						translatedStatements.WriteString(fmt.Sprintf("\t{\n%s\t}\n", defaultBody))
					} else {
						translatedStatements.WriteString(fmt.Sprintf("\telse {\n%s\t}\n", defaultBody))
					}
				}
				if typedStatement.Init != nil {
					translatedStatements.WriteString("\t}\n")
				}
			case *ast.ReturnStmt:
				if functionReturnKind != "void" {
					if len(typedStatement.Results) != 1 {
						return "", false
					}
					translatedResult, resultKind, _, resultOK := translateRunnableExpression(pkg, typedStatement.Results[0], locals)
					if !resultOK || resultKind != functionReturnKind {
						return "", false
					}
					translatedStatements.WriteString(fmt.Sprintf("\treturn %s;\n", translatedResult))
					continue
				}
				if len(typedStatement.Results) != 0 {
					return "", false
				}
				translatedStatements.WriteString("\treturn;\n")
			default:
				return "", false
			}
		}
		return translatedStatements.String(), true
	}
	generateRunnablePackage := func(pkg *runnablePackage) ([]string, map[string]runnableFunctionInfo, []string, bool) {
		generatedDefinitions := make([]string, 0)
		for _, constantName := range pkg.ConstantOrder {
			constantDefinition := pkg.ConstantDefinitions[constantName]
			if constantDefinition == "" {
				return nil, nil, nil, false
			}
			generatedDefinitions = append(generatedDefinitions, constantDefinition)
		}
		for _, variableName := range pkg.VariableOrder {
			variableDefinition := pkg.VariableDefinitions[variableName]
			if variableDefinition == "" {
				return nil, nil, nil, false
			}
			generatedDefinitions = append(generatedDefinitions, variableDefinition)
		}
		exportedFunctions := map[string]runnableFunctionInfo{}
		exportedFunctionOrder := make([]string, 0)
		for _, functionName := range pkg.FunctionOrder {
			functionSymbol := pkg.FunctionSymbols[functionName]
			if functionSymbol == "" {
				return nil, nil, nil, false
			}
			storage := "static "
			if ast.IsExported(functionName) {
				storage = ""
				exportedFunctions[functionName] = runnableFunctionInfo{
					Symbol:     functionSymbol,
					ReturnsInt: pkg.FunctionReturnsInt[functionName],
					ReturnKind: pkg.FunctionReturnKinds[functionName],
					Parameters: append([]string{}, pkg.FunctionParameters[functionName]...),
				}
				exportedFunctionOrder = append(exportedFunctionOrder, functionName)
			}
			returnType, ok := runnableReturnCType(pkg.FunctionReturnKinds[functionName])
			if !ok {
				return nil, nil, nil, false
			}
			generatedDefinitions = append(generatedDefinitions, fmt.Sprintf("%s%s %s(%s);\n", storage, returnType, functionSymbol, formatRunnableParameterDecls(pkg.FunctionParameters[functionName])))
		}
		for _, functionName := range pkg.FunctionOrder {
			functionDecl := pkg.FunctionDecls[functionName]
			if functionDecl == nil {
				return nil, nil, nil, false
			}
			locals := map[string]string{}
			for _, parameterName := range pkg.FunctionParameters[functionName] {
				locals[parameterName] = "int"
			}
			translatedBody, bodyOK := translateRunnableStatementList(pkg, functionDecl.Body.List, locals, pkg.FunctionReturnKinds[functionName], 0)
			if !bodyOK {
				return nil, nil, nil, false
			}
			storage := "static "
			if ast.IsExported(functionName) {
				storage = ""
			}
			returnType, ok := runnableReturnCType(pkg.FunctionReturnKinds[functionName])
			if !ok {
				return nil, nil, nil, false
			}
			generatedDefinitions = append(generatedDefinitions, fmt.Sprintf("%s%s %s(%s) {\n%s}\n", storage, returnType, pkg.FunctionSymbols[functionName], formatRunnableParameterDecls(pkg.FunctionParameters[functionName]), translatedBody))
		}
		return generatedDefinitions, exportedFunctions, exportedFunctionOrder, true
	}

	importedRunnableFunctionsByPath := map[string]map[string]runnableFunctionInfo{}
	importedRunnableFunctionOrderByPath := map[string][]string{}
	importedRunnableBodiesByID := map[string][]string{}
	for _, loweredUnit := range loweredUnits {
		if loweredUnit.Kind != "imported" || loweredUnit.ImportPath == "" {
			continue
		}
		pkg, ok := loadRunnablePackage(loweredUnit)
		if !ok {
			continue
		}
		importedBodies, importedFunctions, importedFunctionOrder, ok := generateRunnablePackage(pkg)
		if !ok || len(importedFunctions) == 0 {
			continue
		}
		importedRunnableFunctionsByPath[loweredUnit.ImportPath] = importedFunctions
		importedRunnableFunctionOrderByPath[loweredUnit.ImportPath] = importedFunctionOrder
		importedRunnableBodiesByID[loweredUnit.ID] = importedBodies
	}

	generatedFiles := make([]GeneratedFile, 0, len(loweredUnits)+6)
	loweredIRUnits := make([]LoweredIRUnit, 0, len(loweredUnits))
	runnableLoweredArtifactEntrypoint := (*string)(nil)
	runnableLoweredArtifactKind := "probe"
	runnableLoweredArtifactReason := "missing-wasi-entrypoint"
	runnableLoweredArtifact := false
	runnableCommandArtifactEntrypoint := (*string)(nil)
	runnableCommandArtifactKind := "probe"
	runnableCommandArtifactReason := "missing-wasi-entrypoint"
	runnableCommandArtifact := false
	loweredSourcesManifestContents, err := json.Marshal(LoweredSourcesManifest{
		EntryFile:    input.EntryFile,
		OptimizeFlag: optimizeFlag,
		Units:        append([]LoweredUnit{}, loweredUnits...),
	})
	if err != nil {
		return Result{}, err
	}
	generatedFiles = append(generatedFiles, GeneratedFile{
		Path:     "/working/tinygo-lowered-sources.json",
		Contents: string(loweredSourcesManifestContents),
	})
	loweredBitcodeFiles := make([]string, 0, len(input.CompileJobs))
	for _, compileJob := range input.CompileJobs {
		loweredBitcodeFiles = append(loweredBitcodeFiles, compileJob.BitcodeOutputPath)
	}
	loweredBitcodeManifestContents, err := json.Marshal(LoweredBitcodeManifest{
		BitcodeFiles: loweredBitcodeFiles,
	})
	if err != nil {
		return Result{}, err
	}
	generatedFiles = append(generatedFiles, GeneratedFile{
		Path:     "/working/tinygo-lowered-bitcode.json",
		Contents: string(loweredBitcodeManifestContents),
	})
	for _, loweredUnit := range loweredUnits {
		if loweredUnit.LoweredSourcePath == "" {
			return Result{}, fmt.Errorf("lowered source path is required for lowered unit %s", loweredUnit.ID)
		}
		symbolID := strings.NewReplacer("-", "_", "/", "_", ".", "_").Replace(loweredUnit.ID)
		sourceHash := uint32(0)
		sourceHashPosition := uint32(1)
		packageName := loweredUnit.PackageName
		importCount := 0
		importPathHash := uint32(0)
		importPathHashPosition := uint32(1)
		blankImportCount := 0
		dotImportCount := 0
		aliasedImportCount := 0
		functionCount := 0
		functionNameHash := uint32(0)
		functionNameHashPosition := uint32(1)
		funcLiteralCount := 0
		funcParameterCount := 0
		funcResultCount := 0
		variadicParameterCount := 0
		namedResultCount := 0
		typeParameterCount := 0
		callExpressionCount := 0
		builtinCallCount := 0
		appendCallCount := 0
		lenCallCount := 0
		makeCallCount := 0
		capCallCount := 0
		copyCallCount := 0
		panicCallCount := 0
		recoverCallCount := 0
		newCallCount := 0
		deleteCallCount := 0
		compositeLiteralCount := 0
		selectorExpressionCount := 0
		selectorNameHash := uint32(0)
		selectorNameHashPosition := uint32(1)
		indexExpressionCount := 0
		sliceExpressionCount := 0
		keyValueExpressionCount := 0
		typeAssertionCount := 0
		blankIdentifierCount := 0
		blankAssignmentTargetCount := 0
		unaryExpressionCount := 0
		binaryExpressionCount := 0
		sendStatementCount := 0
		receiveExpressionCount := 0
		assignStatementCount := 0
		defineStatementCount := 0
		incStatementCount := 0
		decStatementCount := 0
		returnStatementCount := 0
		goStatementCount := 0
		deferStatementCount := 0
		ifStatementCount := 0
		rangeStatementCount := 0
		switchStatementCount := 0
		typeSwitchStatementCount := 0
		typeSwitchCaseClauseCount := 0
		typeSwitchGuardNameHash := uint32(0)
		typeSwitchGuardNameHashPosition := uint32(1)
		typeSwitchCaseTypeHash := uint32(0)
		typeSwitchCaseTypeHashPosition := uint32(1)
		selectStatementCount := 0
		switchCaseClauseCount := 0
		selectCommClauseCount := 0
		forStatementCount := 0
		breakStatementCount := 0
		breakLabelNameHash := uint32(0)
		breakLabelNameHashPosition := uint32(1)
		continueStatementCount := 0
		continueLabelNameHash := uint32(0)
		continueLabelNameHashPosition := uint32(1)
		labeledStatementCount := 0
		labelNameHash := uint32(0)
		labelNameHashPosition := uint32(1)
		gotoStatementCount := 0
		gotoLabelNameHash := uint32(0)
		gotoLabelNameHashPosition := uint32(1)
		fallthroughStatementCount := 0
		methodCount := 0
		methodNameHash := uint32(0)
		methodNameHashPosition := uint32(1)
		methodSignatureHash := uint32(0)
		methodSignatureHashPosition := uint32(1)
		exportedMethodNameHash := uint32(0)
		exportedMethodNameHashPosition := uint32(1)
		exportedMethodSignatureHash := uint32(0)
		exportedMethodSignatureHashPosition := uint32(1)
		exportedFunctionCount := 0
		exportedFunctionNameHash := uint32(0)
		exportedFunctionNameHashPosition := uint32(1)
		genericFunctionCount := 0
		typeCount := 0
		typeNameHash := uint32(0)
		typeNameHashPosition := uint32(1)
		exportedTypeCount := 0
		exportedTypeNameHash := uint32(0)
		exportedTypeNameHashPosition := uint32(1)
		genericTypeCount := 0
		structTypeCount := 0
		interfaceTypeCount := 0
		mapTypeCount := 0
		chanTypeCount := 0
		sendOnlyChanTypeCount := 0
		receiveOnlyChanTypeCount := 0
		arrayTypeCount := 0
		sliceTypeCount := 0
		pointerTypeCount := 0
		structFieldCount := 0
		embeddedStructFieldCount := 0
		taggedStructFieldCount := 0
		structFieldNameHash := uint32(0)
		structFieldNameHashPosition := uint32(1)
		structFieldTypeHash := uint32(0)
		structFieldTypeHashPosition := uint32(1)
		embeddedStructFieldTypeHash := uint32(0)
		embeddedStructFieldTypeHashPosition := uint32(1)
		taggedStructFieldTagHash := uint32(0)
		taggedStructFieldTagHashPosition := uint32(1)
		interfaceMethodCount := 0
		interfaceMethodNameHash := uint32(0)
		interfaceMethodNameHashPosition := uint32(1)
		interfaceMethodSignatureHash := uint32(0)
		interfaceMethodSignatureHashPosition := uint32(1)
		embeddedInterfaceMethodCount := 0
		embeddedInterfaceMethodNameHash := uint32(0)
		embeddedInterfaceMethodNameHashPosition := uint32(1)
		constCount := 0
		constNameHash := uint32(0)
		constNameHashPosition := uint32(1)
		exportedConstNameHash := uint32(0)
		exportedConstNameHashPosition := uint32(1)
		varCount := 0
		varNameHash := uint32(0)
		varNameHashPosition := uint32(1)
		exportedConstCount := 0
		exportedVarCount := 0
		exportedVarNameHash := uint32(0)
		exportedVarNameHashPosition := uint32(1)
		mainCount := 0
		initCount := 0
		imports := make([]LoweredIRImport, 0)
		functions := make([]LoweredIRFunction, 0)
		types := make([]LoweredIRType, 0)
		constants := make([]LoweredIRConstant, 0)
		variables := make([]LoweredIRVariable, 0)
		declarations := make([]LoweredIRDeclaration, 0)
		parsedGoFiles := make([]*ast.File, 0, len(loweredUnit.SourceFiles))
		for _, filePath := range loweredUnit.SourceFiles {
			sourceHashBytes, readErr := os.ReadFile(filePath)
			if readErr != nil {
				sourceHashBytes = []byte(filePath)
			} else if strings.HasSuffix(filePath, ".go") {
				fileSet := token.NewFileSet()
				parsedFile, parseErr := parser.ParseFile(fileSet, filePath, sourceHashBytes, 0)
				if parseErr == nil {
					parsedGoFiles = append(parsedGoFiles, parsedFile)
					if parsedFile.Name != nil {
						packageName = parsedFile.Name.Name
					}
					importCount += len(parsedFile.Imports)
					for _, importSpec := range parsedFile.Imports {
						if importSpec.Name != nil && importSpec.Name.Name == "_" {
							blankImportCount += 1
						}
						if importSpec.Name != nil && importSpec.Name.Name == "." {
							dotImportCount += 1
						}
						if importSpec.Name != nil && importSpec.Name.Name != "_" && importSpec.Name.Name != "." {
							aliasedImportCount += 1
						}
						importPath, unquoteErr := strconv.Unquote(importSpec.Path.Value)
						if unquoteErr != nil {
							continue
						}
						importAlias := ""
						if importSpec.Name != nil {
							importAlias = importSpec.Name.Name
						}
						imports = append(imports, LoweredIRImport{
							Path:  importPath,
							Alias: importAlias,
						})
						for _, b := range []byte(importPath) {
							importPathHash += uint32(b) * importPathHashPosition
							importPathHashPosition += 1
						}
						importPathHash += uint32('\n') * importPathHashPosition
						importPathHashPosition += 1
					}
					for _, decl := range parsedFile.Decls {
						switch typedDecl := decl.(type) {
						case *ast.FuncDecl:
							functionCount += 1
							functionParameterCount := 0
							functionResultCount := 0
							if typedDecl.Type != nil {
								if typedDecl.Type.TypeParams != nil {
									genericFunctionCount += 1
									for _, field := range typedDecl.Type.TypeParams.List {
										if len(field.Names) == 0 {
											typeParameterCount += 1
											continue
										}
										typeParameterCount += len(field.Names)
									}
								}
								if typedDecl.Type.Params != nil {
									for _, field := range typedDecl.Type.Params.List {
										if _, ok := field.Type.(*ast.Ellipsis); ok {
											if len(field.Names) == 0 {
												variadicParameterCount += 1
											} else {
												variadicParameterCount += len(field.Names)
											}
										}
										if len(field.Names) == 0 {
											funcParameterCount += 1
											functionParameterCount += 1
											continue
										}
										funcParameterCount += len(field.Names)
										functionParameterCount += len(field.Names)
									}
								}
								if typedDecl.Type.Results != nil {
									for _, field := range typedDecl.Type.Results.List {
										namedResultCount += len(field.Names)
										if len(field.Names) == 0 {
											funcResultCount += 1
											functionResultCount += 1
											continue
										}
										funcResultCount += len(field.Names)
										functionResultCount += len(field.Names)
									}
								}
							}
							if typedDecl.Name != nil {
								functions = append(functions, LoweredIRFunction{
									Name:       typedDecl.Name.Name,
									Exported:   ast.IsExported(typedDecl.Name.Name),
									Method:     typedDecl.Recv != nil,
									Main:       typedDecl.Name.Name == "main",
									Init:       typedDecl.Name.Name == "init",
									Parameters: functionParameterCount,
									Results:    functionResultCount,
								})
								for _, b := range []byte(typedDecl.Name.Name) {
									functionNameHash += uint32(b) * functionNameHashPosition
									functionNameHashPosition += 1
								}
								functionNameHash += uint32('\n') * functionNameHashPosition
								functionNameHashPosition += 1
								declarations = append(declarations, LoweredIRDeclaration{
									Kind:     "function",
									Name:     typedDecl.Name.Name,
									Exported: ast.IsExported(typedDecl.Name.Name),
									Method:   typedDecl.Recv != nil,
								})
							}
							if typedDecl.Recv != nil {
								methodCount += 1
								methodSignatureSource := ""
								if typedDecl.Type != nil {
									startOffset := fileSet.Position(typedDecl.Type.Pos()).Offset
									endOffset := fileSet.Position(typedDecl.Type.End()).Offset
									if startOffset >= 0 && endOffset >= startOffset && endOffset <= len(sourceHashBytes) {
										methodSignatureSource = strings.TrimSpace(string(sourceHashBytes[startOffset:endOffset]))
									}
								}
								if typedDecl.Name != nil {
									for _, b := range []byte(typedDecl.Name.Name) {
										methodNameHash += uint32(b) * methodNameHashPosition
										methodNameHashPosition += 1
									}
									methodNameHash += uint32('\n') * methodNameHashPosition
									methodNameHashPosition += 1
									if methodSignatureSource != "" {
										for _, b := range []byte(methodSignatureSource) {
											methodSignatureHash += uint32(b) * methodSignatureHashPosition
											methodSignatureHashPosition += 1
										}
										methodSignatureHash += uint32('\n') * methodSignatureHashPosition
										methodSignatureHashPosition += 1
									}
									if ast.IsExported(typedDecl.Name.Name) {
										for _, b := range []byte(typedDecl.Name.Name) {
											exportedMethodNameHash += uint32(b) * exportedMethodNameHashPosition
											exportedMethodNameHashPosition += 1
										}
										exportedMethodNameHash += uint32('\n') * exportedMethodNameHashPosition
										exportedMethodNameHashPosition += 1
										if methodSignatureSource != "" {
											for _, b := range []byte(methodSignatureSource) {
												exportedMethodSignatureHash += uint32(b) * exportedMethodSignatureHashPosition
												exportedMethodSignatureHashPosition += 1
											}
											exportedMethodSignatureHash += uint32('\n') * exportedMethodSignatureHashPosition
											exportedMethodSignatureHashPosition += 1
										}
									}
								}
							} else if typedDecl.Name != nil && ast.IsExported(typedDecl.Name.Name) {
								exportedFunctionCount += 1
								for _, b := range []byte(typedDecl.Name.Name) {
									exportedFunctionNameHash += uint32(b) * exportedFunctionNameHashPosition
									exportedFunctionNameHashPosition += 1
								}
								exportedFunctionNameHash += uint32('\n') * exportedFunctionNameHashPosition
								exportedFunctionNameHashPosition += 1
							}
							if typedDecl.Name != nil {
								if typedDecl.Name.Name == "main" {
									mainCount += 1
								}
								if typedDecl.Name.Name == "init" {
									initCount += 1
								}
							}
							if typedDecl.Body != nil {
								ast.Inspect(typedDecl.Body, func(node ast.Node) bool {
									switch node.(type) {
									case *ast.FuncLit:
										switch typedFuncLit := node.(type) {
										case *ast.FuncLit:
											funcLiteralCount += 1
											if typedFuncLit.Type != nil {
												if typedFuncLit.Type.Params != nil {
													for _, field := range typedFuncLit.Type.Params.List {
														if _, ok := field.Type.(*ast.Ellipsis); ok {
															if len(field.Names) == 0 {
																variadicParameterCount += 1
															} else {
																variadicParameterCount += len(field.Names)
															}
														}
														if len(field.Names) == 0 {
															funcParameterCount += 1
															continue
														}
														funcParameterCount += len(field.Names)
													}
												}
												if typedFuncLit.Type.Results != nil {
													for _, field := range typedFuncLit.Type.Results.List {
														namedResultCount += len(field.Names)
														if len(field.Names) == 0 {
															funcResultCount += 1
															continue
														}
														funcResultCount += len(field.Names)
													}
												}
											}
										}
									case *ast.CallExpr:
										callExpressionCount += 1
										switch typedCall := node.(type) {
										case *ast.CallExpr:
											switch typedFun := typedCall.Fun.(type) {
											case *ast.Ident:
												switch typedFun.Name {
												case "append", "cap", "clear", "close", "complex", "copy", "delete", "imag", "len", "make", "max", "min", "new", "panic", "print", "println", "real", "recover":
													builtinCallCount += 1
												}
												if typedFun.Name == "append" {
													appendCallCount += 1
												}
												if typedFun.Name == "len" {
													lenCallCount += 1
												}
												if typedFun.Name == "make" {
													makeCallCount += 1
												}
												if typedFun.Name == "cap" {
													capCallCount += 1
												}
												if typedFun.Name == "copy" {
													copyCallCount += 1
												}
												if typedFun.Name == "panic" {
													panicCallCount += 1
												}
												if typedFun.Name == "recover" {
													recoverCallCount += 1
												}
												if typedFun.Name == "new" {
													newCallCount += 1
												}
												if typedFun.Name == "delete" {
													deleteCallCount += 1
												}
											}
										}
									case *ast.CompositeLit:
										compositeLiteralCount += 1
									case *ast.SelectorExpr:
										selectorExpressionCount += 1
										switch typedSelector := node.(type) {
										case *ast.SelectorExpr:
											for _, b := range []byte(typedSelector.Sel.Name) {
												selectorNameHash += uint32(b) * selectorNameHashPosition
												selectorNameHashPosition += 1
											}
											selectorNameHash += uint32('\n') * selectorNameHashPosition
											selectorNameHashPosition += 1
										}
									case *ast.IndexExpr:
										indexExpressionCount += 1
									case *ast.SliceExpr:
										sliceExpressionCount += 1
									case *ast.KeyValueExpr:
										keyValueExpressionCount += 1
									case *ast.TypeAssertExpr:
										typeAssertionCount += 1
									case *ast.Ident:
										switch typedIdent := node.(type) {
										case *ast.Ident:
											if typedIdent.Name == "_" {
												blankIdentifierCount += 1
											}
										}
									case *ast.UnaryExpr:
										switch typedExpr := node.(type) {
										case *ast.UnaryExpr:
											unaryExpressionCount += 1
											if typedExpr.Op == token.ARROW {
												receiveExpressionCount += 1
											}
										}
									case *ast.SendStmt:
										sendStatementCount += 1
									case *ast.BinaryExpr:
										binaryExpressionCount += 1
									case *ast.AssignStmt:
										switch typedAssign := node.(type) {
										case *ast.AssignStmt:
											assignStatementCount += 1
											if typedAssign.Tok == token.DEFINE {
												defineStatementCount += 1
											}
											for _, lhs := range typedAssign.Lhs {
												switch typedLHS := lhs.(type) {
												case *ast.Ident:
													if typedLHS.Name == "_" {
														blankAssignmentTargetCount += 1
													}
												}
											}
										}
									case *ast.IncDecStmt:
										switch typedIncDec := node.(type) {
										case *ast.IncDecStmt:
											if typedIncDec.Tok == token.INC {
												incStatementCount += 1
											}
											if typedIncDec.Tok == token.DEC {
												decStatementCount += 1
											}
										}
									case *ast.ReturnStmt:
										returnStatementCount += 1
									case *ast.GoStmt:
										goStatementCount += 1
									case *ast.DeferStmt:
										deferStatementCount += 1
									case *ast.IfStmt:
										ifStatementCount += 1
									case *ast.RangeStmt:
										rangeStatementCount += 1
									case *ast.SwitchStmt, *ast.TypeSwitchStmt:
										switchStatementCount += 1
										switch typedSwitch := node.(type) {
										case *ast.TypeSwitchStmt:
											typeSwitchStatementCount += 1
											typeSwitchCaseClauseCount += len(typedSwitch.Body.List)
											for _, stmt := range typedSwitch.Body.List {
												switch typedCaseClause := stmt.(type) {
												case *ast.CaseClause:
													for _, expr := range typedCaseClause.List {
														startOffset := fileSet.Position(expr.Pos()).Offset
														endOffset := fileSet.Position(expr.End()).Offset
														if startOffset >= 0 && endOffset <= len(sourceHashBytes) && startOffset < endOffset {
															for _, b := range sourceHashBytes[startOffset:endOffset] {
																typeSwitchCaseTypeHash += uint32(b) * typeSwitchCaseTypeHashPosition
																typeSwitchCaseTypeHashPosition += 1
															}
															typeSwitchCaseTypeHash += uint32('\n') * typeSwitchCaseTypeHashPosition
															typeSwitchCaseTypeHashPosition += 1
														}
													}
												}
											}
											switch typedAssign := typedSwitch.Assign.(type) {
											case *ast.AssignStmt:
												for _, lhs := range typedAssign.Lhs {
													switch typedLHS := lhs.(type) {
													case *ast.Ident:
														for _, b := range []byte(typedLHS.Name) {
															typeSwitchGuardNameHash += uint32(b) * typeSwitchGuardNameHashPosition
															typeSwitchGuardNameHashPosition += 1
														}
														typeSwitchGuardNameHash += uint32('\n') * typeSwitchGuardNameHashPosition
														typeSwitchGuardNameHashPosition += 1
													}
												}
											}
										}
									case *ast.SelectStmt:
										selectStatementCount += 1
									case *ast.CaseClause:
										switchCaseClauseCount += 1
									case *ast.CommClause:
										selectCommClauseCount += 1
									case *ast.ForStmt:
										forStatementCount += 1
									case *ast.LabeledStmt:
										labeledStatementCount += 1
										switch typedLabeled := node.(type) {
										case *ast.LabeledStmt:
											if typedLabeled.Label != nil {
												for _, b := range []byte(typedLabeled.Label.Name) {
													labelNameHash += uint32(b) * labelNameHashPosition
													labelNameHashPosition += 1
												}
												labelNameHash += uint32('\n') * labelNameHashPosition
												labelNameHashPosition += 1
											}
										}
									case *ast.BranchStmt:
										switch typedBranch := node.(type) {
										case *ast.BranchStmt:
											if typedBranch.Tok == token.BREAK {
												breakStatementCount += 1
												if typedBranch.Label != nil {
													for _, b := range []byte(typedBranch.Label.Name) {
														breakLabelNameHash += uint32(b) * breakLabelNameHashPosition
														breakLabelNameHashPosition += 1
													}
													breakLabelNameHash += uint32('\n') * breakLabelNameHashPosition
													breakLabelNameHashPosition += 1
												}
											}
											if typedBranch.Tok == token.CONTINUE {
												continueStatementCount += 1
												if typedBranch.Label != nil {
													for _, b := range []byte(typedBranch.Label.Name) {
														continueLabelNameHash += uint32(b) * continueLabelNameHashPosition
														continueLabelNameHashPosition += 1
													}
													continueLabelNameHash += uint32('\n') * continueLabelNameHashPosition
													continueLabelNameHashPosition += 1
												}
											}
											if typedBranch.Tok == token.GOTO {
												gotoStatementCount += 1
												if typedBranch.Label != nil {
													for _, b := range []byte(typedBranch.Label.Name) {
														gotoLabelNameHash += uint32(b) * gotoLabelNameHashPosition
														gotoLabelNameHashPosition += 1
													}
													gotoLabelNameHash += uint32('\n') * gotoLabelNameHashPosition
													gotoLabelNameHashPosition += 1
												}
											}
											if typedBranch.Tok == token.FALLTHROUGH {
												fallthroughStatementCount += 1
											}
										}
									}
									return true
								})
							}
						case *ast.GenDecl:
							switch typedDecl.Tok {
							case token.TYPE:
								for _, spec := range typedDecl.Specs {
									typeSpec, ok := spec.(*ast.TypeSpec)
									if !ok {
										continue
									}
									typeCount += 1
									if typeSpec.Name != nil {
										typeKind := "other"
										switch typedType := typeSpec.Type.(type) {
										case *ast.StructType:
											typeKind = "struct"
										case *ast.InterfaceType:
											typeKind = "interface"
										case *ast.MapType:
											typeKind = "map"
										case *ast.ChanType:
											typeKind = "chan"
										case *ast.ArrayType:
											if typedType.Len == nil {
												typeKind = "slice"
											} else {
												typeKind = "array"
											}
										case *ast.StarExpr:
											typeKind = "pointer"
										}
										types = append(types, LoweredIRType{
											Name:     typeSpec.Name.Name,
											Exported: ast.IsExported(typeSpec.Name.Name),
											Kind:     typeKind,
										})
										declarations = append(declarations, LoweredIRDeclaration{
											Kind:     "type",
											Name:     typeSpec.Name.Name,
											Exported: ast.IsExported(typeSpec.Name.Name),
											Method:   false,
										})
										for _, b := range []byte(typeSpec.Name.Name) {
											typeNameHash += uint32(b) * typeNameHashPosition
											typeNameHashPosition += 1
										}
										typeNameHash += uint32('\n') * typeNameHashPosition
										typeNameHashPosition += 1
									}
									if typeSpec.TypeParams != nil {
										genericTypeCount += 1
										for _, field := range typeSpec.TypeParams.List {
											if len(field.Names) == 0 {
												typeParameterCount += 1
												continue
											}
											typeParameterCount += len(field.Names)
										}
									}
									if typeSpec.Name != nil && ast.IsExported(typeSpec.Name.Name) {
										exportedTypeCount += 1
										for _, b := range []byte(typeSpec.Name.Name) {
											exportedTypeNameHash += uint32(b) * exportedTypeNameHashPosition
											exportedTypeNameHashPosition += 1
										}
										exportedTypeNameHash += uint32('\n') * exportedTypeNameHashPosition
										exportedTypeNameHashPosition += 1
									}
									switch typedType := typeSpec.Type.(type) {
									case *ast.StructType:
										structTypeCount += 1
										if typedType.Fields != nil {
											for _, field := range typedType.Fields.List {
												if field.Tag != nil {
													taggedStructFieldCount += 1
													startOffset := fileSet.Position(field.Tag.Pos()).Offset
													endOffset := fileSet.Position(field.Tag.End()).Offset
													if startOffset >= 0 && endOffset >= startOffset && endOffset <= len(sourceHashBytes) {
														for _, b := range []byte(strings.TrimSpace(string(sourceHashBytes[startOffset:endOffset]))) {
															taggedStructFieldTagHash += uint32(b) * taggedStructFieldTagHashPosition
															taggedStructFieldTagHashPosition += 1
														}
														taggedStructFieldTagHash += uint32('\n') * taggedStructFieldTagHashPosition
														taggedStructFieldTagHashPosition += 1
													}
												}
												if len(field.Names) == 0 {
													structFieldCount += 1
													embeddedStructFieldCount += 1
													startOffset := fileSet.Position(field.Type.Pos()).Offset
													endOffset := fileSet.Position(field.Type.End()).Offset
													if startOffset >= 0 && endOffset >= startOffset && endOffset <= len(sourceHashBytes) {
														for _, b := range []byte(strings.TrimSpace(string(sourceHashBytes[startOffset:endOffset]))) {
															embeddedStructFieldTypeHash += uint32(b) * embeddedStructFieldTypeHashPosition
															embeddedStructFieldTypeHashPosition += 1
														}
														embeddedStructFieldTypeHash += uint32('\n') * embeddedStructFieldTypeHashPosition
														embeddedStructFieldTypeHashPosition += 1
													}
													continue
												}
												startOffset := fileSet.Position(field.Type.Pos()).Offset
												endOffset := fileSet.Position(field.Type.End()).Offset
												fieldTypeSource := ""
												if startOffset >= 0 && endOffset >= startOffset && endOffset <= len(sourceHashBytes) {
													fieldTypeSource = strings.TrimSpace(string(sourceHashBytes[startOffset:endOffset]))
												}
												for _, name := range field.Names {
													if name == nil {
														continue
													}
													for _, b := range []byte(name.Name) {
														structFieldNameHash += uint32(b) * structFieldNameHashPosition
														structFieldNameHashPosition += 1
													}
													structFieldNameHash += uint32('\n') * structFieldNameHashPosition
													structFieldNameHashPosition += 1
													if fieldTypeSource != "" {
														for _, b := range []byte(fieldTypeSource) {
															structFieldTypeHash += uint32(b) * structFieldTypeHashPosition
															structFieldTypeHashPosition += 1
														}
														structFieldTypeHash += uint32('\n') * structFieldTypeHashPosition
														structFieldTypeHashPosition += 1
													}
												}
												structFieldCount += len(field.Names)
											}
										}
									case *ast.InterfaceType:
										interfaceTypeCount += 1
										if typedType.Methods != nil {
											for _, method := range typedType.Methods.List {
												if len(method.Names) == 0 {
													interfaceMethodCount += 1
													embeddedInterfaceMethodCount += 1
													startOffset := fileSet.Position(method.Type.Pos()).Offset
													endOffset := fileSet.Position(method.Type.End()).Offset
													if startOffset >= 0 && endOffset >= startOffset && endOffset <= len(sourceHashBytes) {
														for _, b := range []byte(strings.TrimSpace(string(sourceHashBytes[startOffset:endOffset]))) {
															embeddedInterfaceMethodNameHash += uint32(b) * embeddedInterfaceMethodNameHashPosition
															embeddedInterfaceMethodNameHashPosition += 1
														}
														embeddedInterfaceMethodNameHash += uint32('\n') * embeddedInterfaceMethodNameHashPosition
														embeddedInterfaceMethodNameHashPosition += 1
													}
													continue
												}
												startOffset := fileSet.Position(method.Type.Pos()).Offset
												endOffset := fileSet.Position(method.Type.End()).Offset
												methodSignatureSource := ""
												if startOffset >= 0 && endOffset >= startOffset && endOffset <= len(sourceHashBytes) {
													methodSignatureSource = strings.TrimSpace(string(sourceHashBytes[startOffset:endOffset]))
												}
												for _, name := range method.Names {
													if name == nil {
														continue
													}
													for _, b := range []byte(name.Name) {
														interfaceMethodNameHash += uint32(b) * interfaceMethodNameHashPosition
														interfaceMethodNameHashPosition += 1
													}
													interfaceMethodNameHash += uint32('\n') * interfaceMethodNameHashPosition
													interfaceMethodNameHashPosition += 1
													if methodSignatureSource != "" {
														for _, b := range []byte(methodSignatureSource) {
															interfaceMethodSignatureHash += uint32(b) * interfaceMethodSignatureHashPosition
															interfaceMethodSignatureHashPosition += 1
														}
														interfaceMethodSignatureHash += uint32('\n') * interfaceMethodSignatureHashPosition
														interfaceMethodSignatureHashPosition += 1
													}
												}
												interfaceMethodCount += len(method.Names)
											}
										}
									}
								}
							case token.CONST:
								constCount += len(typedDecl.Specs)
								for _, spec := range typedDecl.Specs {
									valueSpec, ok := spec.(*ast.ValueSpec)
									if !ok {
										continue
									}
									for _, name := range valueSpec.Names {
										if name != nil {
											constants = append(constants, LoweredIRConstant{
												Name:     name.Name,
												Exported: ast.IsExported(name.Name),
											})
											declarations = append(declarations, LoweredIRDeclaration{
												Kind:     "const",
												Name:     name.Name,
												Exported: ast.IsExported(name.Name),
												Method:   false,
											})
											for _, b := range []byte(name.Name) {
												constNameHash += uint32(b) * constNameHashPosition
												constNameHashPosition += 1
											}
											constNameHash += uint32('\n') * constNameHashPosition
											constNameHashPosition += 1
										}
										if name != nil && ast.IsExported(name.Name) {
											exportedConstCount += 1
											for _, b := range []byte(name.Name) {
												exportedConstNameHash += uint32(b) * exportedConstNameHashPosition
												exportedConstNameHashPosition += 1
											}
											exportedConstNameHash += uint32('\n') * exportedConstNameHashPosition
											exportedConstNameHashPosition += 1
										}
									}
								}
							case token.VAR:
								varCount += len(typedDecl.Specs)
								for _, spec := range typedDecl.Specs {
									valueSpec, ok := spec.(*ast.ValueSpec)
									if !ok {
										continue
									}
									for _, name := range valueSpec.Names {
										if name != nil {
											variables = append(variables, LoweredIRVariable{
												Name:     name.Name,
												Exported: ast.IsExported(name.Name),
											})
											declarations = append(declarations, LoweredIRDeclaration{
												Kind:     "var",
												Name:     name.Name,
												Exported: ast.IsExported(name.Name),
												Method:   false,
											})
											for _, b := range []byte(name.Name) {
												varNameHash += uint32(b) * varNameHashPosition
												varNameHashPosition += 1
											}
											varNameHash += uint32('\n') * varNameHashPosition
											varNameHashPosition += 1
										}
										if name != nil && ast.IsExported(name.Name) {
											exportedVarCount += 1
											for _, b := range []byte(name.Name) {
												exportedVarNameHash += uint32(b) * exportedVarNameHashPosition
												exportedVarNameHashPosition += 1
											}
											exportedVarNameHash += uint32('\n') * exportedVarNameHashPosition
											exportedVarNameHashPosition += 1
										}
									}
								}
							default:
								continue
							}
						}
					}
					ast.Inspect(parsedFile, func(node ast.Node) bool {
						switch typedNode := node.(type) {
						case *ast.MapType:
							mapTypeCount += 1
						case *ast.ChanType:
							chanTypeCount += 1
							if typedNode.Dir == ast.SEND {
								sendOnlyChanTypeCount += 1
							}
							if typedNode.Dir == ast.RECV {
								receiveOnlyChanTypeCount += 1
							}
						case *ast.ArrayType:
							arrayTypeCount += 1
							if typedNode.Len == nil {
								sliceTypeCount += 1
							}
						case *ast.StarExpr:
							pointerTypeCount += 1
						}
						return true
					})
				}
			}
			for _, b := range sourceHashBytes {
				sourceHash += uint32(b) * sourceHashPosition
				sourceHashPosition += 1
			}
			sourceHash += uint32('\n') * sourceHashPosition
			sourceHashPosition += 1
		}
		var loweredSourceContents strings.Builder
		loweredSourceContents.WriteString("/* generated by wasm-tinygo tinygo lowering backend */\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_id[] = %q;\n", symbolID, loweredUnit.ID))
		loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_kind[] = %q;\n", symbolID, loweredUnit.Kind))
		loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_package_dir[] = %q;\n", symbolID, loweredUnit.PackageDir))
		if packageName != "" {
			loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_package_name[] = %q;\n", symbolID, packageName))
		}
		unitLoweringPrefix := fmt.Sprintf("tinygo_lower_unit_begin(%q, %q, %q, %d);", loweredUnit.ID, loweredUnit.Kind, packageName, len(loweredUnit.SourceFiles))
		unitLoweringSuffix := "tinygo_lower_unit_end()"
		placeholderBlocks := make([]LoweredIRLoweringBlock, 0, len(imports)+len(functions)+len(declarations))
		loweringBlocks := make([]LoweredIRLoweringBlock, 0, len(imports)+len(functions)+len(declarations))
		var importStream strings.Builder
		for _, loweredImport := range imports {
			if loweredImport.Alias != "" {
				importStream.WriteString(loweredImport.Alias)
				importStream.WriteString("=")
			}
			importStream.WriteString(loweredImport.Path)
			importStream.WriteString("\n")
		}
		loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_import_stream[] = %q;\n", symbolID, importStream.String()))
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_import_table[] = {\n", symbolID))
		for _, loweredImport := range imports {
			importSignature := ""
			if loweredImport.Alias != "" {
				importSignature += loweredImport.Alias
				importSignature += "="
			}
			importSignature += loweredImport.Path
			loweredSourceContents.WriteString(fmt.Sprintf("\t%q,\n", importSignature))
		}
		loweredSourceContents.WriteString("};\n")
		for importIndex, loweredImport := range imports {
			importBlock := "import:" + loweredImport.Path
			if loweredImport.Alias != "" {
				importBlock = "import:" + loweredImport.Alias + "=" + loweredImport.Path
			}
			importSignature := loweredImport.Path
			if loweredImport.Alias != "" {
				importSignature = loweredImport.Alias + "=" + loweredImport.Path
			}
			loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_import_block_value_%03d[] = %q;\n", symbolID, importIndex, importBlock))
			placeholderBlocks = append(placeholderBlocks, LoweredIRLoweringBlock{
				Stage:     "import",
				Index:     importIndex,
				Value:     importBlock,
				Signature: importSignature,
			})
		}
		importProbeBlockIndexes := make([]int, 0, len(imports))
		importLoweringBlockIndexes := make([]int, 0, len(imports))
		for importIndex, loweredImport := range imports {
			importProbeBlockIndexes = append(importProbeBlockIndexes, importIndex)
			importSignature := loweredImport.Path
			if loweredImport.Alias != "" {
				importSignature = loweredImport.Alias + "=" + loweredImport.Path
			}
			loweringBlocks = append(loweringBlocks, LoweredIRLoweringBlock{
				Stage: "import",
				Index: importIndex,
				Value: fmt.Sprintf(
					"%stinygo_lower_import_begin();tinygo_emit_import_index(%d);tinygo_emit_import_alias(%q);tinygo_emit_import_path(%q);tinygo_emit_import_signature(%q);tinygo_lower_import_end();%s",
					unitLoweringPrefix,
					importIndex,
					loweredImport.Alias,
					loweredImport.Path,
					importSignature,
					unitLoweringSuffix,
				),
			})
			importLoweringBlockIndexes = append(importLoweringBlockIndexes, len(loweringBlocks)-1)
		}
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_placeholder_block_table[];\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_lowering_block_table[];\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("static const unsigned int tinygo_lowered_%s_import_probe_index_table[] = {\n", symbolID))
		for _, probeBlockIndex := range importProbeBlockIndexes {
			loweredSourceContents.WriteString(fmt.Sprintf("\t%du,\n", probeBlockIndex))
		}
		loweredSourceContents.WriteString("};\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const unsigned int tinygo_lowered_%s_import_lowering_index_table[] = {\n", symbolID))
		for _, loweringBlockIndex := range importLoweringBlockIndexes {
			loweredSourceContents.WriteString(fmt.Sprintf("\t%du,\n", loweringBlockIndex))
		}
		loweredSourceContents.WriteString("};\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_import_lowering(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(imports)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_lowering_block_table[tinygo_lowered_%s_import_lowering_index_table[index]];\n", symbolID, symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_import_probe(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(imports)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_placeholder_block_table[tinygo_lowered_%s_import_probe_index_table[index]];\n", symbolID, symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		for importIndex := range imports {
			loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_import_block_%03d(void) {\n", symbolID, importIndex))
			loweredSourceContents.WriteString(fmt.Sprintf("\treturn tinygo_lowered_%s_run_import_probe(%du);\n", symbolID, importIndex))
			loweredSourceContents.WriteString("}\n")
		}
		var functionStream strings.Builder
		for _, loweredFunction := range functions {
			functionStream.WriteString(loweredFunction.Name)
			functionStream.WriteString(":")
			if loweredFunction.Exported {
				functionStream.WriteString("1")
			} else {
				functionStream.WriteString("0")
			}
			functionStream.WriteString(":")
			if loweredFunction.Method {
				functionStream.WriteString("1")
			} else {
				functionStream.WriteString("0")
			}
			functionStream.WriteString(":")
			if loweredFunction.Main {
				functionStream.WriteString("1")
			} else {
				functionStream.WriteString("0")
			}
			functionStream.WriteString(":")
			if loweredFunction.Init {
				functionStream.WriteString("1")
			} else {
				functionStream.WriteString("0")
			}
			functionStream.WriteString(":")
			functionStream.WriteString(strconv.Itoa(loweredFunction.Parameters))
			functionStream.WriteString(":")
			functionStream.WriteString(strconv.Itoa(loweredFunction.Results))
			functionStream.WriteString("\n")
		}
		loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_function_stream[] = %q;\n", symbolID, functionStream.String()))
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_function_table[] = {\n", symbolID))
		for _, loweredFunction := range functions {
			functionSignature := loweredFunction.Name + ":"
			if loweredFunction.Exported {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Method {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Main {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Init {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			functionSignature += strconv.Itoa(loweredFunction.Parameters)
			functionSignature += ":"
			functionSignature += strconv.Itoa(loweredFunction.Results)
			loweredSourceContents.WriteString(fmt.Sprintf("\t%q,\n", functionSignature))
		}
		loweredSourceContents.WriteString("};\n")
		functionLoweringBlockIndexes := make([]int, 0, len(functions))
		for functionIndex, loweredFunction := range functions {
			functionBlock := loweredFunction.Name + ":"
			if loweredFunction.Exported {
				functionBlock += "1"
			} else {
				functionBlock += "0"
			}
			functionBlock += ":"
			if loweredFunction.Method {
				functionBlock += "1"
			} else {
				functionBlock += "0"
			}
			functionBlock += ":"
			if loweredFunction.Main {
				functionBlock += "1"
			} else {
				functionBlock += "0"
			}
			functionBlock += ":"
			if loweredFunction.Init {
				functionBlock += "1"
			} else {
				functionBlock += "0"
			}
			functionBlock += ":"
			functionBlock += strconv.Itoa(loweredFunction.Parameters)
			functionBlock += ":"
			functionBlock += strconv.Itoa(loweredFunction.Results)
			functionBlock = "function:" + functionBlock
			functionSignature := loweredFunction.Name + ":"
			if loweredFunction.Exported {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Method {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Main {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Init {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			functionSignature += strconv.Itoa(loweredFunction.Parameters)
			functionSignature += ":"
			functionSignature += strconv.Itoa(loweredFunction.Results)
			loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_function_block_value_%03d[] = %q;\n", symbolID, functionIndex, functionBlock))
			placeholderBlocks = append(placeholderBlocks, LoweredIRLoweringBlock{
				Stage:     "function",
				Index:     functionIndex,
				Value:     functionBlock,
				Signature: functionSignature,
			})
		}
		functionProbeBlockIndexes := make([]int, 0, len(functions))
		for functionIndex, loweredFunction := range functions {
			functionProbeBlockIndexes = append(functionProbeBlockIndexes, len(imports)+functionIndex)
			exported := 0
			if loweredFunction.Exported {
				exported = 1
			}
			method := 0
			if loweredFunction.Method {
				method = 1
			}
			main := 0
			if loweredFunction.Main {
				main = 1
			}
			init := 0
			if loweredFunction.Init {
				init = 1
			}
			functionSignature := loweredFunction.Name + ":"
			if loweredFunction.Exported {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Method {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Main {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			if loweredFunction.Init {
				functionSignature += "1"
			} else {
				functionSignature += "0"
			}
			functionSignature += ":"
			functionSignature += strconv.Itoa(loweredFunction.Parameters)
			functionSignature += ":"
			functionSignature += strconv.Itoa(loweredFunction.Results)
			loweringBlocks = append(loweringBlocks, LoweredIRLoweringBlock{
				Stage: "function",
				Index: functionIndex,
				Value: fmt.Sprintf(
					"%stinygo_lower_function_begin(%q, %q);tinygo_emit_function_index(%d);tinygo_emit_function_flags(%d, %d, %d, %d);tinygo_emit_function_signature(%d, %d);tinygo_emit_function_stream(%q);tinygo_lower_function_end();%s",
					unitLoweringPrefix,
					packageName,
					loweredFunction.Name,
					functionIndex,
					exported,
					method,
					main,
					init,
					loweredFunction.Parameters,
					loweredFunction.Results,
					functionSignature,
					unitLoweringSuffix,
				),
			})
			functionLoweringBlockIndexes = append(functionLoweringBlockIndexes, len(loweringBlocks)-1)
		}
		loweredSourceContents.WriteString(fmt.Sprintf("static const unsigned int tinygo_lowered_%s_function_lowering_index_table[] = {\n", symbolID))
		for _, loweringBlockIndex := range functionLoweringBlockIndexes {
			loweredSourceContents.WriteString(fmt.Sprintf("\t%du,\n", loweringBlockIndex))
		}
		loweredSourceContents.WriteString("};\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const unsigned int tinygo_lowered_%s_function_probe_index_table[] = {\n", symbolID))
		for _, probeBlockIndex := range functionProbeBlockIndexes {
			loweredSourceContents.WriteString(fmt.Sprintf("\t%du,\n", probeBlockIndex))
		}
		loweredSourceContents.WriteString("};\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_function_lowering(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(functions)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_lowering_block_table[tinygo_lowered_%s_function_lowering_index_table[index]];\n", symbolID, symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_function_probe(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(functions)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_placeholder_block_table[tinygo_lowered_%s_function_probe_index_table[index]];\n", symbolID, symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		for functionIndex := range functions {
			loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_function_block_%03d(void) {\n", symbolID, functionIndex))
			loweredSourceContents.WriteString(fmt.Sprintf("\treturn tinygo_lowered_%s_run_function_probe(%du);\n", symbolID, functionIndex))
			loweredSourceContents.WriteString("}\n")
		}
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_import_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", importCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_import_path_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", importPathHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_blank_import_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", blankImportCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_dot_import_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", dotImportCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_aliased_import_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", aliasedImportCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_function_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", functionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_function_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", functionNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_func_literal_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", funcLiteralCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_func_parameter_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", funcParameterCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_func_result_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", funcResultCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_variadic_parameter_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", variadicParameterCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_named_result_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", namedResultCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_type_parameter_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", typeParameterCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_generic_function_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", genericFunctionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_generic_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", genericTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_call_expression_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", callExpressionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_builtin_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", builtinCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_append_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", appendCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_len_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", lenCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_make_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", makeCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_cap_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", capCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_copy_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", copyCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_panic_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", panicCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_recover_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", recoverCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_new_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", newCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_delete_call_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", deleteCallCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_composite_literal_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", compositeLiteralCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_selector_expression_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", selectorExpressionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_selector_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", selectorNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_index_expression_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", indexExpressionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_slice_expression_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", sliceExpressionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_key_value_expression_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", keyValueExpressionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_type_assertion_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", typeAssertionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_blank_identifier_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", blankIdentifierCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_blank_assignment_target_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", blankAssignmentTargetCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_unary_expression_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", unaryExpressionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_binary_expression_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", binaryExpressionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_send_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", sendStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_receive_expression_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", receiveExpressionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_assign_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", assignStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_define_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", defineStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_inc_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", incStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_dec_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", decStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_return_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", returnStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_go_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", goStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_defer_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", deferStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_if_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", ifStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_range_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", rangeStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_switch_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", switchStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_type_switch_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", typeSwitchStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_type_switch_case_clause_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", typeSwitchCaseClauseCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_type_switch_guard_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", typeSwitchGuardNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_type_switch_case_type_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", typeSwitchCaseTypeHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_select_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", selectStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_switch_case_clause_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", switchCaseClauseCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_select_comm_clause_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", selectCommClauseCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_for_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", forStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_break_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", breakStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_break_label_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", breakLabelNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_continue_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", continueStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_continue_label_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", continueLabelNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_labeled_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", labeledStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_label_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", labelNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_goto_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", gotoStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_goto_label_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", gotoLabelNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_fallthrough_statement_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", fallthroughStatementCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_method_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", methodCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_method_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", methodNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_method_signature_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", methodSignatureHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_method_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedMethodNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_method_signature_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedMethodSignatureHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_function_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedFunctionCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_function_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedFunctionNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", typeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_type_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", typeNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_type_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedTypeNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_struct_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", structTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_interface_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", interfaceTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_map_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", mapTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_chan_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", chanTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_send_only_chan_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", sendOnlyChanTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_receive_only_chan_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", receiveOnlyChanTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_array_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", arrayTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_slice_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", sliceTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_pointer_type_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", pointerTypeCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_struct_field_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", structFieldCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_embedded_struct_field_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", embeddedStructFieldCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_tagged_struct_field_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", taggedStructFieldCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_struct_field_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", structFieldNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_struct_field_type_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", structFieldTypeHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_embedded_struct_field_type_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", embeddedStructFieldTypeHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_tagged_struct_field_tag_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", taggedStructFieldTagHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_interface_method_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", interfaceMethodCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_interface_method_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", interfaceMethodNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_interface_method_signature_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", interfaceMethodSignatureHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_embedded_interface_method_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", embeddedInterfaceMethodCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_embedded_interface_method_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", embeddedInterfaceMethodNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_const_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", constCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_const_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", constNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_var_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", varCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_var_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", varNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_const_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedConstCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_const_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedConstNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_var_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedVarCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_exported_var_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", exportedVarNameHash))
		loweredSourceContents.WriteString("}\n")
		declarationNameHash := uint32(0)
		declarationNameHashPosition := uint32(1)
		declarationSignatureHash := uint32(0)
		declarationSignatureHashPosition := uint32(1)
		declarationKindHash := uint32(0)
		declarationKindHashPosition := uint32(1)
		declarationExportedCount := 0
		declarationExportedNameHash := uint32(0)
		declarationExportedNameHashPosition := uint32(1)
		declarationExportedSignatureHash := uint32(0)
		declarationExportedSignatureHashPosition := uint32(1)
		declarationExportedKindHash := uint32(0)
		declarationExportedKindHashPosition := uint32(1)
		declarationMethodCount := 0
		declarationMethodNameHash := uint32(0)
		declarationMethodNameHashPosition := uint32(1)
		declarationMethodSignatureHash := uint32(0)
		declarationMethodSignatureHashPosition := uint32(1)
		declarationMethodKindHash := uint32(0)
		declarationMethodKindHashPosition := uint32(1)
		var declarationStream strings.Builder
		for _, declaration := range declarations {
			for _, b := range []byte(declaration.Name) {
				declarationNameHash += uint32(b) * declarationNameHashPosition
				declarationNameHashPosition += 1
			}
			declarationNameHash += uint32('\n') * declarationNameHashPosition
			declarationNameHashPosition += 1
			declarationSignature := declaration.Kind + ":" + declaration.Name + ":0:0"
			if declaration.Exported {
				declarationSignature = declaration.Kind + ":" + declaration.Name + ":1:0"
			}
			if declaration.Method {
				if declaration.Exported {
					declarationSignature = declaration.Kind + ":" + declaration.Name + ":1:1"
				} else {
					declarationSignature = declaration.Kind + ":" + declaration.Name + ":0:1"
				}
			}
			declarationStream.WriteString(declarationSignature)
			declarationStream.WriteString("\n")
			for _, b := range []byte(declarationSignature) {
				declarationSignatureHash += uint32(b) * declarationSignatureHashPosition
				declarationSignatureHashPosition += 1
			}
			declarationSignatureHash += uint32('\n') * declarationSignatureHashPosition
			declarationSignatureHashPosition += 1
			for _, b := range []byte(declaration.Kind) {
				declarationKindHash += uint32(b) * declarationKindHashPosition
				declarationKindHashPosition += 1
			}
			declarationKindHash += uint32('\n') * declarationKindHashPosition
			declarationKindHashPosition += 1
			if declaration.Exported {
				declarationExportedCount += 1
				for _, b := range []byte(declaration.Name) {
					declarationExportedNameHash += uint32(b) * declarationExportedNameHashPosition
					declarationExportedNameHashPosition += 1
				}
				declarationExportedNameHash += uint32('\n') * declarationExportedNameHashPosition
				declarationExportedNameHashPosition += 1
				for _, b := range []byte(declarationSignature) {
					declarationExportedSignatureHash += uint32(b) * declarationExportedSignatureHashPosition
					declarationExportedSignatureHashPosition += 1
				}
				declarationExportedSignatureHash += uint32('\n') * declarationExportedSignatureHashPosition
				declarationExportedSignatureHashPosition += 1
				for _, b := range []byte(declaration.Kind) {
					declarationExportedKindHash += uint32(b) * declarationExportedKindHashPosition
					declarationExportedKindHashPosition += 1
				}
				declarationExportedKindHash += uint32('\n') * declarationExportedKindHashPosition
				declarationExportedKindHashPosition += 1
			}
			if declaration.Method {
				declarationMethodCount += 1
				for _, b := range []byte(declaration.Name) {
					declarationMethodNameHash += uint32(b) * declarationMethodNameHashPosition
					declarationMethodNameHashPosition += 1
				}
				declarationMethodNameHash += uint32('\n') * declarationMethodNameHashPosition
				declarationMethodNameHashPosition += 1
				for _, b := range []byte(declarationSignature) {
					declarationMethodSignatureHash += uint32(b) * declarationMethodSignatureHashPosition
					declarationMethodSignatureHashPosition += 1
				}
				declarationMethodSignatureHash += uint32('\n') * declarationMethodSignatureHashPosition
				declarationMethodSignatureHashPosition += 1
				for _, b := range []byte(declaration.Kind) {
					declarationMethodKindHash += uint32(b) * declarationMethodKindHashPosition
					declarationMethodKindHashPosition += 1
				}
				declarationMethodKindHash += uint32('\n') * declarationMethodKindHashPosition
				declarationMethodKindHashPosition += 1
			}
		}
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", len(declarations)))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_declaration_stream[] = %q;\n", symbolID, declarationStream.String()))
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_declaration_table[] = {\n", symbolID))
		for _, declaration := range declarations {
			declarationSignature := declaration.Kind + ":" + declaration.Name + ":0:0"
			if declaration.Exported {
				declarationSignature = declaration.Kind + ":" + declaration.Name + ":1:0"
			}
			if declaration.Method {
				if declaration.Exported {
					declarationSignature = declaration.Kind + ":" + declaration.Name + ":1:1"
				} else {
					declarationSignature = declaration.Kind + ":" + declaration.Name + ":0:1"
				}
			}
			loweredSourceContents.WriteString(fmt.Sprintf("\t%q,\n", declarationSignature))
		}
		loweredSourceContents.WriteString("};\n")
		declarationLoweringBlockIndexes := make([]int, 0, len(declarations))
		for declarationIndex, declaration := range declarations {
			declarationBlock := declaration.Kind + ":" + declaration.Name + ":0:0"
			if declaration.Exported {
				declarationBlock = declaration.Kind + ":" + declaration.Name + ":1:0"
			}
			if declaration.Method {
				if declaration.Exported {
					declarationBlock = declaration.Kind + ":" + declaration.Name + ":1:1"
				} else {
					declarationBlock = declaration.Kind + ":" + declaration.Name + ":0:1"
				}
			}
			declarationBlock = "declaration:" + declarationBlock
			declarationSignature := declaration.Kind + ":" + declaration.Name + ":0:0"
			if declaration.Exported {
				declarationSignature = declaration.Kind + ":" + declaration.Name + ":1:0"
			}
			if declaration.Method {
				if declaration.Exported {
					declarationSignature = declaration.Kind + ":" + declaration.Name + ":1:1"
				} else {
					declarationSignature = declaration.Kind + ":" + declaration.Name + ":0:1"
				}
			}
			loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_declaration_block_value_%03d[] = %q;\n", symbolID, declarationIndex, declarationBlock))
			placeholderBlocks = append(placeholderBlocks, LoweredIRLoweringBlock{
				Stage:     "declaration",
				Index:     declarationIndex,
				Value:     declarationBlock,
				Signature: declarationSignature,
			})
		}
		declarationProbeBlockIndexes := make([]int, 0, len(declarations))
		for declarationIndex, declaration := range declarations {
			declarationProbeBlockIndexes = append(declarationProbeBlockIndexes, len(imports)+len(functions)+declarationIndex)
			exported := 0
			if declaration.Exported {
				exported = 1
			}
			method := 0
			if declaration.Method {
				method = 1
			}
			declarationSignature := declaration.Kind + ":" + declaration.Name + ":0:0"
			if declaration.Exported {
				declarationSignature = declaration.Kind + ":" + declaration.Name + ":1:0"
			}
			if declaration.Method {
				if declaration.Exported {
					declarationSignature = declaration.Kind + ":" + declaration.Name + ":1:1"
				} else {
					declarationSignature = declaration.Kind + ":" + declaration.Name + ":0:1"
				}
			}
			loweringBlocks = append(loweringBlocks, LoweredIRLoweringBlock{
				Stage: "declaration",
				Index: declarationIndex,
				Value: fmt.Sprintf(
					"%stinygo_lower_declaration_begin(%q, %q, %q);tinygo_emit_declaration_index(%d);tinygo_emit_declaration_flags(%d, %d);tinygo_emit_declaration_signature(%q);tinygo_lower_declaration_end();%s",
					unitLoweringPrefix,
					packageName,
					declaration.Kind,
					declaration.Name,
					declarationIndex,
					exported,
					method,
					declarationSignature,
					unitLoweringSuffix,
				),
			})
			declarationLoweringBlockIndexes = append(declarationLoweringBlockIndexes, len(loweringBlocks)-1)
		}
		loweredSourceContents.WriteString(fmt.Sprintf("static const unsigned int tinygo_lowered_%s_declaration_lowering_index_table[] = {\n", symbolID))
		for _, loweringBlockIndex := range declarationLoweringBlockIndexes {
			loweredSourceContents.WriteString(fmt.Sprintf("\t%du,\n", loweringBlockIndex))
		}
		loweredSourceContents.WriteString("};\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const unsigned int tinygo_lowered_%s_declaration_probe_index_table[] = {\n", symbolID))
		for _, probeBlockIndex := range declarationProbeBlockIndexes {
			loweredSourceContents.WriteString(fmt.Sprintf("\t%du,\n", probeBlockIndex))
		}
		loweredSourceContents.WriteString("};\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_declaration_lowering(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(declarations)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_lowering_block_table[tinygo_lowered_%s_declaration_lowering_index_table[index]];\n", symbolID, symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_declaration_probe(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(declarations)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_placeholder_block_table[tinygo_lowered_%s_declaration_probe_index_table[index]];\n", symbolID, symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		for declarationIndex := range declarations {
			loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_declaration_block_%03d(void) {\n", symbolID, declarationIndex))
			loweredSourceContents.WriteString(fmt.Sprintf("\treturn tinygo_lowered_%s_run_declaration_probe(%du);\n", symbolID, declarationIndex))
			loweredSourceContents.WriteString("}\n")
		}
		placeholderBlockHash := uint32(0)
		placeholderBlockHashPosition := uint32(1)
		loweringBlockHash := uint32(0)
		loweringBlockHashPosition := uint32(1)
		placeholderBlockSignatureHash := uint32(0)
		placeholderBlockSignatureHashPosition := uint32(1)
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_placeholder_block_table[] = {\n", symbolID))
		for importIndex, loweredImport := range imports {
			loweredSourceContents.WriteString(fmt.Sprintf("\ttinygo_lowered_%s_import_block_value_%03d,\n", symbolID, importIndex))
			placeholderBlock := "import:" + loweredImport.Path
			if loweredImport.Alias != "" {
				placeholderBlock = "import:" + loweredImport.Alias + "=" + loweredImport.Path
			}
			for _, b := range []byte(placeholderBlock) {
				placeholderBlockHash += uint32(b) * placeholderBlockHashPosition
				placeholderBlockHashPosition += 1
			}
			placeholderBlockHash += uint32('\n') * placeholderBlockHashPosition
			placeholderBlockHashPosition += 1
			importSignature := loweredImport.Path
			if loweredImport.Alias != "" {
				importSignature = loweredImport.Alias + "=" + loweredImport.Path
			}
			loweringBlock := fmt.Sprintf(
				"%stinygo_lower_import_begin();tinygo_emit_import_index(%d);tinygo_emit_import_alias(%q);tinygo_emit_import_path(%q);tinygo_emit_import_signature(%q);tinygo_lower_import_end();%s",
				unitLoweringPrefix,
				importIndex,
				loweredImport.Alias,
				loweredImport.Path,
				importSignature,
				unitLoweringSuffix,
			)
			for _, b := range []byte(loweringBlock) {
				loweringBlockHash += uint32(b) * loweringBlockHashPosition
				loweringBlockHashPosition += 1
			}
			loweringBlockHash += uint32('\n') * loweringBlockHashPosition
			loweringBlockHashPosition += 1
		}
		for functionIndex, loweredFunction := range functions {
			loweredSourceContents.WriteString(fmt.Sprintf("\ttinygo_lowered_%s_function_block_value_%03d,\n", symbolID, functionIndex))
			placeholderBlock := "function:" + loweredFunction.Name + ":"
			if loweredFunction.Exported {
				placeholderBlock += "1"
			} else {
				placeholderBlock += "0"
			}
			placeholderBlock += ":"
			if loweredFunction.Method {
				placeholderBlock += "1"
			} else {
				placeholderBlock += "0"
			}
			placeholderBlock += ":"
			if loweredFunction.Main {
				placeholderBlock += "1"
			} else {
				placeholderBlock += "0"
			}
			placeholderBlock += ":"
			if loweredFunction.Init {
				placeholderBlock += "1"
			} else {
				placeholderBlock += "0"
			}
			placeholderBlock += ":"
			placeholderBlock += strconv.Itoa(loweredFunction.Parameters)
			placeholderBlock += ":"
			placeholderBlock += strconv.Itoa(loweredFunction.Results)
			for _, b := range []byte(placeholderBlock) {
				placeholderBlockHash += uint32(b) * placeholderBlockHashPosition
				placeholderBlockHashPosition += 1
			}
			placeholderBlockHash += uint32('\n') * placeholderBlockHashPosition
			placeholderBlockHashPosition += 1
			loweringFunctionExported := 0
			if loweredFunction.Exported {
				loweringFunctionExported = 1
			}
			loweringFunctionMethod := 0
			if loweredFunction.Method {
				loweringFunctionMethod = 1
			}
			loweringFunctionMain := 0
			if loweredFunction.Main {
				loweringFunctionMain = 1
			}
			loweringFunctionInit := 0
			if loweredFunction.Init {
				loweringFunctionInit = 1
			}
			loweringFunctionSignature := loweredFunction.Name + ":"
			if loweredFunction.Exported {
				loweringFunctionSignature += "1"
			} else {
				loweringFunctionSignature += "0"
			}
			loweringFunctionSignature += ":"
			if loweredFunction.Method {
				loweringFunctionSignature += "1"
			} else {
				loweringFunctionSignature += "0"
			}
			loweringFunctionSignature += ":"
			if loweredFunction.Main {
				loweringFunctionSignature += "1"
			} else {
				loweringFunctionSignature += "0"
			}
			loweringFunctionSignature += ":"
			if loweredFunction.Init {
				loweringFunctionSignature += "1"
			} else {
				loweringFunctionSignature += "0"
			}
			loweringFunctionSignature += ":"
			loweringFunctionSignature += strconv.Itoa(loweredFunction.Parameters)
			loweringFunctionSignature += ":"
			loweringFunctionSignature += strconv.Itoa(loweredFunction.Results)
			loweringBlock := fmt.Sprintf(
				"%stinygo_lower_function_begin(%q, %q);tinygo_emit_function_index(%d);tinygo_emit_function_flags(%d, %d, %d, %d);tinygo_emit_function_signature(%d, %d);tinygo_emit_function_stream(%q);tinygo_lower_function_end();%s",
				unitLoweringPrefix,
				packageName,
				loweredFunction.Name,
				functionIndex,
				loweringFunctionExported,
				loweringFunctionMethod,
				loweringFunctionMain,
				loweringFunctionInit,
				loweredFunction.Parameters,
				loweredFunction.Results,
				loweringFunctionSignature,
				unitLoweringSuffix,
			)
			for _, b := range []byte(loweringBlock) {
				loweringBlockHash += uint32(b) * loweringBlockHashPosition
				loweringBlockHashPosition += 1
			}
			loweringBlockHash += uint32('\n') * loweringBlockHashPosition
			loweringBlockHashPosition += 1
		}
		for declarationIndex, declaration := range declarations {
			loweredSourceContents.WriteString(fmt.Sprintf("\ttinygo_lowered_%s_declaration_block_value_%03d,\n", symbolID, declarationIndex))
			placeholderBlock := declaration.Kind + ":" + declaration.Name + ":0:0"
			if declaration.Exported {
				placeholderBlock = declaration.Kind + ":" + declaration.Name + ":1:0"
			}
			if declaration.Method {
				if declaration.Exported {
					placeholderBlock = declaration.Kind + ":" + declaration.Name + ":1:1"
				} else {
					placeholderBlock = declaration.Kind + ":" + declaration.Name + ":0:1"
				}
			}
			placeholderBlock = "declaration:" + placeholderBlock
			for _, b := range []byte(placeholderBlock) {
				placeholderBlockHash += uint32(b) * placeholderBlockHashPosition
				placeholderBlockHashPosition += 1
			}
			placeholderBlockHash += uint32('\n') * placeholderBlockHashPosition
			placeholderBlockHashPosition += 1
			loweringDeclarationExported := 0
			if declaration.Exported {
				loweringDeclarationExported = 1
			}
			loweringDeclarationMethod := 0
			if declaration.Method {
				loweringDeclarationMethod = 1
			}
			loweringDeclarationSignature := declaration.Kind + ":" + declaration.Name + ":0:0"
			if declaration.Exported {
				loweringDeclarationSignature = declaration.Kind + ":" + declaration.Name + ":1:0"
			}
			if declaration.Method {
				if declaration.Exported {
					loweringDeclarationSignature = declaration.Kind + ":" + declaration.Name + ":1:1"
				} else {
					loweringDeclarationSignature = declaration.Kind + ":" + declaration.Name + ":0:1"
				}
			}
			loweringBlock := fmt.Sprintf(
				"%stinygo_lower_declaration_begin(%q, %q, %q);tinygo_emit_declaration_index(%d);tinygo_emit_declaration_flags(%d, %d);tinygo_emit_declaration_signature(%q);tinygo_lower_declaration_end();%s",
				unitLoweringPrefix,
				packageName,
				declaration.Kind,
				declaration.Name,
				declarationIndex,
				loweringDeclarationExported,
				loweringDeclarationMethod,
				loweringDeclarationSignature,
				unitLoweringSuffix,
			)
			for _, b := range []byte(loweringBlock) {
				loweringBlockHash += uint32(b) * loweringBlockHashPosition
				loweringBlockHashPosition += 1
			}
			loweringBlockHash += uint32('\n') * loweringBlockHashPosition
			loweringBlockHashPosition += 1
		}
		loweredSourceContents.WriteString("};\n")
		for placeholderBlockIndex, placeholderBlock := range placeholderBlocks {
			loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_placeholder_block_signature_value_%03d[] = %q;\n", symbolID, placeholderBlockIndex, placeholderBlock.Signature))
			for _, b := range []byte(placeholderBlock.Signature) {
				placeholderBlockSignatureHash += uint32(b) * placeholderBlockSignatureHashPosition
				placeholderBlockSignatureHashPosition += 1
			}
			placeholderBlockSignatureHash += uint32('\n') * placeholderBlockSignatureHashPosition
			placeholderBlockSignatureHashPosition += 1
		}
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_placeholder_block_signature_table[] = {\n", symbolID))
		for placeholderBlockIndex := range placeholderBlocks {
			loweredSourceContents.WriteString(fmt.Sprintf("\ttinygo_lowered_%s_placeholder_block_signature_value_%03d,\n", symbolID, placeholderBlockIndex))
		}
		loweredSourceContents.WriteString("};\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_placeholder_block_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", len(imports)+len(functions)+len(declarations)))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_lowering_block_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", len(loweringBlocks)))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_placeholder_block_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", placeholderBlockHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_lowering_block_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", loweringBlockHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_placeholder_block_signature_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", placeholderBlockSignatureHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_placeholder_block_signature(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(imports)+len(functions)+len(declarations)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_placeholder_block_signature_table[index];\n", symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_placeholder_block(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(imports)+len(functions)+len(declarations)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_placeholder_block_table[index];\n", symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		for loweringBlockIndex, loweringBlock := range loweringBlocks {
			loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_lowering_block_value_%03d[] = %q;\n", symbolID, loweringBlockIndex, loweringBlock.Value))
		}
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_lowering_block_table[] = {\n", symbolID))
		for loweringBlockIndex := range loweringBlocks {
			loweredSourceContents.WriteString(fmt.Sprintf("\ttinygo_lowered_%s_lowering_block_value_%03d,\n", symbolID, loweringBlockIndex))
		}
		loweredSourceContents.WriteString("};\n")
		loweredSourceContents.WriteString(fmt.Sprintf("static const char *tinygo_lowered_%s_run_lowering_block(unsigned int index) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\tif (index < %du) {\n", len(loweringBlocks)))
		loweredSourceContents.WriteString(fmt.Sprintf("\t\treturn tinygo_lowered_%s_lowering_block_table[index];\n", symbolID))
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn \"\";\n")
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_lowering_block_runtime_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString("\tunsigned int hash = 0u;\n")
		loweredSourceContents.WriteString("\tunsigned int position = 1u;\n")
		loweredSourceContents.WriteString("\tunsigned int index = 0u;\n")
		loweredSourceContents.WriteString("\twhile (index < ")
		loweredSourceContents.WriteString(strconv.Itoa(len(loweringBlocks)))
		loweredSourceContents.WriteString("u) {\n")
		loweredSourceContents.WriteString(fmt.Sprintf("\t\tconst char *value = tinygo_lowered_%s_run_lowering_block(index);\n", symbolID))
		loweredSourceContents.WriteString("\t\twhile (*value != '\\0') {\n")
		loweredSourceContents.WriteString("\t\t\thash += ((unsigned int)(unsigned char)(*value)) * position;\n")
		loweredSourceContents.WriteString("\t\t\tposition += 1u;\n")
		loweredSourceContents.WriteString("\t\t\tvalue += 1;\n")
		loweredSourceContents.WriteString("\t\t}\n")
		loweredSourceContents.WriteString("\t\thash += 10u * position;\n")
		loweredSourceContents.WriteString("\t\tposition += 1u;\n")
		loweredSourceContents.WriteString("\t\tindex += 1u;\n")
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn hash;\n")
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_placeholder_block_runtime_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString("\tunsigned int hash = 0u;\n")
		loweredSourceContents.WriteString("\tunsigned int position = 1u;\n")
		loweredSourceContents.WriteString("\tunsigned int index = 0u;\n")
		loweredSourceContents.WriteString("\twhile (index < ")
		loweredSourceContents.WriteString(strconv.Itoa(len(imports) + len(functions) + len(declarations)))
		loweredSourceContents.WriteString("u) {\n")
		loweredSourceContents.WriteString(fmt.Sprintf("\t\tconst char *value = tinygo_lowered_%s_run_placeholder_block(index);\n", symbolID))
		loweredSourceContents.WriteString("\t\twhile (*value != '\\0') {\n")
		loweredSourceContents.WriteString("\t\t\thash += ((unsigned int)(unsigned char)(*value)) * position;\n")
		loweredSourceContents.WriteString("\t\t\tposition += 1u;\n")
		loweredSourceContents.WriteString("\t\t\tvalue += 1;\n")
		loweredSourceContents.WriteString("\t\t}\n")
		loweredSourceContents.WriteString("\t\thash += 10u * position;\n")
		loweredSourceContents.WriteString("\t\tposition += 1u;\n")
		loweredSourceContents.WriteString("\t\tindex += 1u;\n")
		loweredSourceContents.WriteString("\t}\n")
		loweredSourceContents.WriteString("\treturn hash;\n")
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_signature_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationSignatureHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_kind_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationKindHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_exported_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationExportedCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_exported_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationExportedNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_exported_signature_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationExportedSignatureHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_exported_kind_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationExportedKindHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_method_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationMethodCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_method_name_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationMethodNameHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_method_signature_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationMethodSignatureHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_declaration_method_kind_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", declarationMethodKindHash))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_main_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", mainCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_init_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", initCount))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_kind_tag(void) {\n", symbolID))
		switch loweredUnit.Kind {
		case "program":
			loweredSourceContents.WriteString("\treturn 1u;\n")
		case "imported":
			loweredSourceContents.WriteString("\treturn 2u;\n")
		case "stdlib":
			loweredSourceContents.WriteString("\treturn 3u;\n")
		default:
			loweredSourceContents.WriteString("\treturn 0u;\n")
		}
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_source_file_count(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", len(loweredUnit.SourceFiles)))
		loweredSourceContents.WriteString("}\n")
		loweredSourceContents.WriteString(fmt.Sprintf("unsigned int tinygo_lowered_%s_source_hash(void) {\n", symbolID))
		loweredSourceContents.WriteString(fmt.Sprintf("\treturn %du;\n", sourceHash))
		loweredSourceContents.WriteString("}\n")
		for fileIndex, filePath := range loweredUnit.SourceFiles {
			loweredSourceContents.WriteString(fmt.Sprintf("static const char tinygo_lowered_%s_source_%03d[] = %q;\n", symbolID, fileIndex, filePath))
		}
		if loweredUnit.Kind == "imported" {
			if bodies, ok := importedRunnableBodiesByID[loweredUnit.ID]; ok {
				loweredSourceContents.WriteString("\nextern void tinygo_runtime_print_literal(const char *value, unsigned int len, int newline);\n")
				loweredSourceContents.WriteString("extern void tinygo_runtime_print_i32(int value, int newline);\n")
				loweredSourceContents.WriteString("extern void tinygo_runtime_print_newline(void);\n")
				loweredSourceContents.WriteString("extern void tinygo_runtime_print_string(const char *value, int newline);\n")
				loweredSourceContents.WriteString("extern int tinygo_runtime_string_len(char *value);\n")
				loweredSourceContents.WriteString("extern int tinygo_runtime_string_equal(const char *left, const char *right);\n")
				for _, body := range bodies {
					loweredSourceContents.WriteString(body)
				}
			}
		}
		if loweredUnit.Kind == "program" && len(parsedGoFiles) >= 1 && len(types) == 0 {
			supportsRunnableProgram := true
			supportedRunnableImports := map[string]struct{}{
				"bufio":   {},
				"fmt":     {},
				"os":      {},
				"strconv": {},
				"strings": {},
			}
			aliasToImportPath := map[string]string{}
			topLevelConstants := map[string]struct{}{}
			topLevelConstantKinds := map[string]string{}
			topLevelVariables := map[string]struct{}{}
			topLevelVariableKinds := map[string]string{}
			topLevelFunctionReturnKinds := map[string]string{}
			topLevelFunctionDefinitions := map[string]string{}
			topLevelFunctionParameters := map[string][]string{}
			functionDecls := map[string]*ast.FuncDecl{}
			functionOrder := make([]string, 0)
			constantOrder := make([]string, 0)
			variableOrder := make([]string, 0)
			for _, parsedProgramFile := range parsedGoFiles {
				for _, decl := range parsedProgramFile.Decls {
					switch typedDecl := decl.(type) {
					case *ast.GenDecl:
						if typedDecl.Tok == token.IMPORT {
							for _, spec := range typedDecl.Specs {
								importSpec, ok := spec.(*ast.ImportSpec)
								if !ok || importSpec.Path == nil {
									supportsRunnableProgram = false
									continue
								}
								importPath, err := strconv.Unquote(importSpec.Path.Value)
								if err != nil {
									supportsRunnableProgram = false
									continue
								}
								if _, ok := supportedRunnableImports[importPath]; !ok {
									if _, ok := importedRunnableFunctionsByPath[importPath]; !ok {
										supportsRunnableProgram = false
										continue
									}
								}
								alias := path.Base(importPath)
								if importSpec.Name != nil {
									if importSpec.Name.Name == "_" || importSpec.Name.Name == "." || importSpec.Name.Name == "" {
										supportsRunnableProgram = false
										continue
									}
									alias = importSpec.Name.Name
								}
								if alias == "" {
									supportsRunnableProgram = false
									continue
								}
								if existingImportPath, ok := aliasToImportPath[alias]; ok && existingImportPath != importPath {
									supportsRunnableProgram = false
									continue
								}
								aliasToImportPath[alias] = importPath
							}
							continue
						}
						if typedDecl.Tok == token.VAR {
							for _, spec := range typedDecl.Specs {
								valueSpec, ok := spec.(*ast.ValueSpec)
								if !ok || len(valueSpec.Names) == 0 || (len(valueSpec.Values) != 0 && len(valueSpec.Values) != len(valueSpec.Names)) {
									supportsRunnableProgram = false
									continue
								}
								explicitKind := ""
								if valueSpec.Type != nil {
									typeIdent, ok := valueSpec.Type.(*ast.Ident)
									if !ok || (typeIdent.Name != "int" && typeIdent.Name != "string" && typeIdent.Name != "bool") {
										supportsRunnableProgram = false
										continue
									}
									explicitKind = typeIdent.Name
									if explicitKind == "bool" {
										explicitKind = "int"
									}
								}
								for index, name := range valueSpec.Names {
									if name == nil || name.Name == "" {
										supportsRunnableProgram = false
										continue
									}
									if _, exists := topLevelConstants[name.Name]; exists {
										supportsRunnableProgram = false
										continue
									}
									if _, exists := topLevelVariables[name.Name]; exists {
										supportsRunnableProgram = false
										continue
									}
									variableKind := explicitKind
									variableInitializer := ""
									if len(valueSpec.Values) == 0 {
										switch variableKind {
										case "int":
											variableInitializer = "0"
										case "string":
											variableInitializer = strconv.Quote("")
										default:
											supportsRunnableProgram = false
											continue
										}
									} else {
										valueExpression := valueSpec.Values[index]
										switch typedValue := valueExpression.(type) {
										case *ast.BasicLit:
											switch typedValue.Kind {
											case token.INT:
												if variableKind != "" && variableKind != "int" {
													supportsRunnableProgram = false
													continue
												}
												variableKind = "int"
												variableInitializer = typedValue.Value
											case token.STRING:
												if variableKind != "" && variableKind != "string" {
													supportsRunnableProgram = false
													continue
												}
												unquotedValue, err := strconv.Unquote(typedValue.Value)
												if err != nil {
													supportsRunnableProgram = false
													continue
												}
												variableKind = "string"
												variableInitializer = strconv.Quote(unquotedValue)
											default:
												supportsRunnableProgram = false
												continue
											}
										case *ast.UnaryExpr:
											if typedValue.Op != token.SUB || (variableKind != "" && variableKind != "int") {
												supportsRunnableProgram = false
												continue
											}
											basicValue, ok := typedValue.X.(*ast.BasicLit)
											if !ok || basicValue.Kind != token.INT {
												supportsRunnableProgram = false
												continue
											}
											variableKind = "int"
											variableInitializer = "-" + basicValue.Value
										case *ast.Ident:
											boolValue, ok := runnableBoolLiteralValue(typedValue.Name)
											if !ok || (variableKind != "" && variableKind != "int") {
												supportsRunnableProgram = false
												continue
											}
											variableKind = "int"
											variableInitializer = boolValue
										default:
											supportsRunnableProgram = false
											continue
										}
									}
									topLevelVariables[name.Name] = struct{}{}
									topLevelVariableKinds[name.Name] = variableKind
									variableOrder = append(variableOrder, name.Name)
									switch variableKind {
									case "int":
										topLevelFunctionDefinitions[name.Name] = fmt.Sprintf("static int %s = %s;\n", name.Name, variableInitializer)
									case "string":
										topLevelFunctionDefinitions[name.Name] = fmt.Sprintf("static char *%s = %s;\n", name.Name, variableInitializer)
									default:
										supportsRunnableProgram = false
									}
								}
							}
							continue
						}
						if typedDecl.Tok != token.CONST {
							supportsRunnableProgram = false
							continue
						}
						for _, spec := range typedDecl.Specs {
							valueSpec, ok := spec.(*ast.ValueSpec)
							if !ok || len(valueSpec.Names) == 0 || len(valueSpec.Values) != len(valueSpec.Names) {
								supportsRunnableProgram = false
								continue
							}
							if valueSpec.Type != nil {
								typeIdent, ok := valueSpec.Type.(*ast.Ident)
								if !ok || (typeIdent.Name != "int" && typeIdent.Name != "string" && typeIdent.Name != "bool") {
									supportsRunnableProgram = false
									continue
								}
							}
							for index, name := range valueSpec.Names {
								if name == nil || name.Name == "" {
									supportsRunnableProgram = false
									continue
								}
								if _, exists := topLevelVariables[name.Name]; exists {
									supportsRunnableProgram = false
									continue
								}
								valueExpression := valueSpec.Values[index]
								switch typedValue := valueExpression.(type) {
								case *ast.BasicLit:
									switch typedValue.Kind {
									case token.INT:
										topLevelConstants[name.Name] = struct{}{}
										topLevelConstantKinds[name.Name] = "int"
										constantOrder = append(constantOrder, name.Name)
										topLevelFunctionDefinitions[name.Name] = fmt.Sprintf("static const int %s = %s;\n", name.Name, typedValue.Value)
									case token.STRING:
										unquotedValue, err := strconv.Unquote(typedValue.Value)
										if err != nil {
											supportsRunnableProgram = false
											continue
										}
										topLevelConstants[name.Name] = struct{}{}
										topLevelConstantKinds[name.Name] = "string"
										constantOrder = append(constantOrder, name.Name)
										topLevelFunctionDefinitions[name.Name] = fmt.Sprintf("static char *%s = %s;\n", name.Name, strconv.Quote(unquotedValue))
									default:
										supportsRunnableProgram = false
										continue
									}
								case *ast.UnaryExpr:
									if typedValue.Op != token.SUB {
										supportsRunnableProgram = false
										continue
									}
									basicValue, ok := typedValue.X.(*ast.BasicLit)
									if !ok || basicValue.Kind != token.INT {
										supportsRunnableProgram = false
										continue
									}
									topLevelConstants[name.Name] = struct{}{}
									topLevelConstantKinds[name.Name] = "int"
									constantOrder = append(constantOrder, name.Name)
									topLevelFunctionDefinitions[name.Name] = fmt.Sprintf("static const int %s = -%s;\n", name.Name, basicValue.Value)
								case *ast.Ident:
									boolValue, ok := runnableBoolLiteralValue(typedValue.Name)
									if !ok {
										supportsRunnableProgram = false
										continue
									}
									topLevelConstants[name.Name] = struct{}{}
									topLevelConstantKinds[name.Name] = "int"
									constantOrder = append(constantOrder, name.Name)
									topLevelFunctionDefinitions[name.Name] = fmt.Sprintf("static const int %s = %s;\n", name.Name, boolValue)
								default:
									supportsRunnableProgram = false
								}
							}
						}
					case *ast.FuncDecl:
						if typedDecl.Recv != nil || typedDecl.Type == nil || typedDecl.Name == nil || typedDecl.Name.Name == "" || typedDecl.Body == nil || typedDecl.Type.TypeParams != nil {
							supportsRunnableProgram = false
							continue
						}
						functionName := typedDecl.Name.Name
						functionParameters := make([]string, 0)
						if typedDecl.Type.Params != nil {
							for _, field := range typedDecl.Type.Params.List {
								typeIdent, ok := field.Type.(*ast.Ident)
								if !ok || typeIdent.Name != "int" || len(field.Names) == 0 {
									supportsRunnableProgram = false
									continue
								}
								for _, name := range field.Names {
									if name == nil || name.Name == "" {
										supportsRunnableProgram = false
										continue
									}
									functionParameters = append(functionParameters, name.Name)
								}
							}
						}
						functionReturnKind := "void"
						if typedDecl.Type.Results != nil {
							if len(typedDecl.Type.Results.List) != 1 {
								supportsRunnableProgram = false
								continue
							}
							resultField := typedDecl.Type.Results.List[0]
							typeIdent, ok := resultField.Type.(*ast.Ident)
							if !ok || (typeIdent.Name != "int" && typeIdent.Name != "string") || len(resultField.Names) > 1 {
								supportsRunnableProgram = false
								continue
							}
							functionReturnKind = typeIdent.Name
						}
						if functionName == "main" {
							if functionReturnKind != "void" || len(functionParameters) != 0 {
								supportsRunnableProgram = false
								continue
							}
							topLevelFunctionDefinitions[functionName] = "int main(void);\n"
						} else {
							returnType, ok := runnableReturnCType(functionReturnKind)
							if !ok {
								supportsRunnableProgram = false
								continue
							}
							topLevelFunctionDefinitions[functionName] = fmt.Sprintf("static %s %s(%s);\n", returnType, functionName, formatRunnableParameterDecls(functionParameters))
						}
						topLevelFunctionReturnKinds[functionName] = functionReturnKind
						topLevelFunctionParameters[functionName] = append([]string{}, functionParameters...)
						functionOrder = append(functionOrder, functionName)
						functionDecls[functionName] = typedDecl
					default:
						supportsRunnableProgram = false
					}
				}
			}
			if _, ok := topLevelFunctionReturnKinds["main"]; !ok {
				supportsRunnableProgram = false
			}
			if supportsRunnableProgram {
				resolveImportedSelector := func(expression ast.Expr) (string, string, bool) {
					selectorExpression, ok := expression.(*ast.SelectorExpr)
					if !ok {
						return "", "", false
					}
					packageIdent, ok := selectorExpression.X.(*ast.Ident)
					if !ok || selectorExpression.Sel == nil {
						return "", "", false
					}
					importPath, ok := aliasToImportPath[packageIdent.Name]
					if !ok {
						return "", "", false
					}
					return importPath, selectorExpression.Sel.Name, true
				}
				var translateExpression func(ast.Expr, map[string]string) (string, string, int, bool)
				translateExpression = func(expression ast.Expr, locals map[string]string) (string, string, int, bool) {
					switch typedExpression := expression.(type) {
					case *ast.BasicLit:
						if typedExpression.Kind == token.INT {
							return typedExpression.Value, "int", 0, true
						}
						if typedExpression.Kind == token.STRING {
							unquotedValue, err := strconv.Unquote(typedExpression.Value)
							if err != nil {
								return "", "", 0, false
							}
							return strconv.Quote(unquotedValue), "string", len([]byte(unquotedValue)), true
						}
						return "", "", 0, false
					case *ast.Ident:
						if boolValue, ok := runnableBoolLiteralValue(typedExpression.Name); ok {
							return boolValue, "int", 0, true
						}
						if localKind, ok := locals[typedExpression.Name]; ok {
							return typedExpression.Name, localKind, 0, true
						}
						if _, ok := topLevelConstants[typedExpression.Name]; ok {
							constantKind, ok := topLevelConstantKinds[typedExpression.Name]
							if !ok {
								return "", "", 0, false
							}
							return typedExpression.Name, constantKind, 0, true
						}
						if _, ok := topLevelVariables[typedExpression.Name]; ok {
							variableKind, ok := topLevelVariableKinds[typedExpression.Name]
							if !ok {
								return "", "", 0, false
							}
							return typedExpression.Name, variableKind, 0, true
						}
						if typedExpression.Name == "nil" {
							return "0", "nil", 0, true
						}
						return "", "", 0, false
					case *ast.BinaryExpr:
						leftValue, leftKind, _, leftOK := translateExpression(typedExpression.X, locals)
						rightValue, rightKind, _, rightOK := translateExpression(typedExpression.Y, locals)
						if !leftOK || !rightOK {
							return "", "", 0, false
						}
						switch typedExpression.Op {
						case token.ADD, token.SUB, token.MUL, token.QUO, token.REM:
							if leftKind != "int" || rightKind != "int" {
								return "", "", 0, false
							}
							return fmt.Sprintf("(%s %s %s)", leftValue, typedExpression.Op.String(), rightValue), "int", 0, true
						case token.EQL, token.NEQ:
							if leftKind == "string" || rightKind == "string" {
								if leftKind != "string" || rightKind != "string" {
									return "", "", 0, false
								}
								translatedComparison, comparisonOK := runnableStringCompareExpression(leftValue, rightValue, typedExpression.Op)
								if !comparisonOK {
									return "", "", 0, false
								}
								return translatedComparison, "int", 0, true
							}
							leftComparable := leftKind == "int" || leftKind == "error" || leftKind == "nil"
							rightComparable := rightKind == "int" || rightKind == "error" || rightKind == "nil"
							if !leftComparable || !rightComparable {
								return "", "", 0, false
							}
							return fmt.Sprintf("(%s %s %s)", leftValue, typedExpression.Op.String(), rightValue), "int", 0, true
						case token.LSS, token.GTR, token.LEQ, token.GEQ:
							leftComparable := leftKind == "int" || leftKind == "error" || leftKind == "nil"
							rightComparable := rightKind == "int" || rightKind == "error" || rightKind == "nil"
							if !leftComparable || !rightComparable {
								return "", "", 0, false
							}
							return fmt.Sprintf("(%s %s %s)", leftValue, typedExpression.Op.String(), rightValue), "int", 0, true
						case token.LAND, token.LOR:
							if leftKind != "int" || rightKind != "int" {
								return "", "", 0, false
							}
							return fmt.Sprintf("(%s %s %s)", leftValue, typedExpression.Op.String(), rightValue), "int", 0, true
						default:
							return "", "", 0, false
						}
					case *ast.CallExpr:
						if importPath, selectorName, ok := resolveImportedSelector(typedExpression.Fun); ok {
							if importPath == "strings" && selectorName == "TrimSpace" && len(typedExpression.Args) == 1 {
								translatedArgument, argumentKind, _, argumentOK := translateExpression(typedExpression.Args[0], locals)
								if !argumentOK || argumentKind != "string" {
									return "", "", 0, false
								}
								return fmt.Sprintf("tinygo_runtime_trim_space(%s)", translatedArgument), "string", 0, true
							}
							importedFunctionMap, ok := importedRunnableFunctionsByPath[importPath]
							if !ok || !ast.IsExported(selectorName) {
								return "", "", 0, false
							}
							functionInfo, ok := importedFunctionMap[selectorName]
							if !ok || (functionInfo.ReturnKind != "int" && functionInfo.ReturnKind != "string") || len(functionInfo.Parameters) != len(typedExpression.Args) {
								return "", "", 0, false
							}
							translatedArgs := make([]string, 0, len(typedExpression.Args))
							for _, argument := range typedExpression.Args {
								translatedArgument, argumentKind, _, argumentOK := translateExpression(argument, locals)
								if !argumentOK || argumentKind != "int" {
									return "", "", 0, false
								}
								translatedArgs = append(translatedArgs, translatedArgument)
							}
							return fmt.Sprintf("%s(%s)", functionInfo.Symbol, strings.Join(translatedArgs, ", ")), functionInfo.ReturnKind, 0, true
						}
						functionIdent, ok := typedExpression.Fun.(*ast.Ident)
						if !ok {
							return "", "", 0, false
						}
						functionName := functionIdent.Name
						if functionName == "len" && len(typedExpression.Args) == 1 {
							translatedArgument, argumentKind, byteLength, argumentOK := translateExpression(typedExpression.Args[0], locals)
							if !argumentOK || argumentKind != "string" {
								return "", "", 0, false
							}
							if byteLength > 0 {
								return strconv.Itoa(byteLength), "int", 0, true
							}
							return fmt.Sprintf("tinygo_runtime_string_len(%s)", translatedArgument), "int", 0, true
						}
						returnKind, ok := topLevelFunctionReturnKinds[functionName]
						if !ok || (returnKind != "int" && returnKind != "string") {
							return "", "", 0, false
						}
						parameterNames := topLevelFunctionParameters[functionName]
						if len(parameterNames) != len(typedExpression.Args) {
							return "", "", 0, false
						}
						translatedArgs := make([]string, 0, len(typedExpression.Args))
						for _, argument := range typedExpression.Args {
							translatedArgument, argumentKind, _, argumentOK := translateExpression(argument, locals)
							if !argumentOK || argumentKind != "int" {
								return "", "", 0, false
							}
							translatedArgs = append(translatedArgs, translatedArgument)
						}
						return fmt.Sprintf("%s(%s)", functionName, strings.Join(translatedArgs, ", ")), returnKind, 0, true
					case *ast.ParenExpr:
						return translateExpression(typedExpression.X, locals)
					case *ast.UnaryExpr:
						translatedValue, translatedKind, _, translatedOK := translateExpression(typedExpression.X, locals)
						if !translatedOK || translatedKind != "int" {
							return "", "", 0, false
						}
						switch typedExpression.Op {
						case token.SUB, token.ADD:
							return fmt.Sprintf("(%s%s)", typedExpression.Op.String(), translatedValue), "int", 0, true
						case token.NOT:
							return fmt.Sprintf("(!%s)", translatedValue), "int", 0, true
						default:
							return "", "", 0, false
						}
					default:
						return "", "", 0, false
					}
				}
				var translateStatementList func([]ast.Stmt, map[string]string, string, int) (string, bool)
				translateStatementList = func(statements []ast.Stmt, locals map[string]string, functionReturnKind string, loopDepth int) (string, bool) {
					var translatedStatements strings.Builder
					for _, statement := range statements {
						switch typedStatement := statement.(type) {
						case *ast.ExprStmt:
							callExpression, ok := typedStatement.X.(*ast.CallExpr)
							if !ok {
								return "", false
							}
							callIdent, callIdentOK := callExpression.Fun.(*ast.Ident)
							if callIdentOK && (callIdent.Name == "print" || callIdent.Name == "println") {
								for argumentIndex, argument := range callExpression.Args {
									translatedArgument, argumentKind, byteLength, argumentOK := translateExpression(argument, locals)
									if !argumentOK {
										return "", false
									}
									newline := 0
									if callIdent.Name == "println" && argumentIndex == len(callExpression.Args)-1 {
										newline = 1
									}
									if !appendRunnablePrintArgument(&translatedStatements, translatedArgument, argumentKind, byteLength, newline) {
										return "", false
									}
								}
								if callIdent.Name == "println" && len(callExpression.Args) == 0 {
									translatedStatements.WriteString("\ttinygo_runtime_print_newline();\n")
								}
								continue
							}
							if importPath, selectorName, ok := resolveImportedSelector(callExpression.Fun); ok {
								if importPath == "fmt" && (selectorName == "Print" || selectorName == "Println") {
									for argumentIndex, argument := range callExpression.Args {
										translatedArgument, argumentKind, byteLength, argumentOK := translateExpression(argument, locals)
										if !argumentOK {
											return "", false
										}
										newline := 0
										if selectorName == "Println" && argumentIndex == len(callExpression.Args)-1 {
											newline = 1
										}
										if !appendRunnablePrintArgument(&translatedStatements, translatedArgument, argumentKind, byteLength, newline) {
											return "", false
										}
									}
									if selectorName == "Println" && len(callExpression.Args) == 0 {
										translatedStatements.WriteString("\ttinygo_runtime_print_newline();\n")
									}
									continue
								}
								if importPath == "fmt" && selectorName == "Printf" && len(callExpression.Args) >= 1 {
									if !appendRunnablePrintf(&translatedStatements, callExpression.Args[0], callExpression.Args[1:], locals, translateExpression) {
										return "", false
									}
									continue
								}
								if importedFunctionMap, ok := importedRunnableFunctionsByPath[importPath]; ok {
									if !ast.IsExported(selectorName) {
										return "", false
									}
									functionInfo, ok := importedFunctionMap[selectorName]
									if !ok || functionInfo.Symbol == "" || len(functionInfo.Parameters) != len(callExpression.Args) {
										return "", false
									}
									translatedArgs := make([]string, 0, len(callExpression.Args))
									for _, argument := range callExpression.Args {
										translatedArgument, argumentKind, _, argumentOK := translateExpression(argument, locals)
										if !argumentOK || argumentKind != "int" {
											return "", false
										}
										translatedArgs = append(translatedArgs, translatedArgument)
									}
									translatedStatements.WriteString(fmt.Sprintf("\t%s(%s);\n", functionInfo.Symbol, strings.Join(translatedArgs, ", ")))
									continue
								}
								return "", false
							}
							if !callIdentOK {
								return "", false
							}
							returnKind := topLevelFunctionReturnKinds[callIdent.Name]
							translatedCall, argumentKind, _, callOK := translateExpression(callExpression, locals)
							if !callOK || (returnKind == "int" || returnKind == "string") && argumentKind != returnKind {
								return "", false
							}
							translatedStatements.WriteString(fmt.Sprintf("\t%s;\n", translatedCall))
						case *ast.DeclStmt:
							translatedDecl, declOK := translateRunnableLocalScalarDecl(typedStatement, locals, translateExpression)
							if !declOK {
								return "", false
							}
							translatedStatements.WriteString(translatedDecl)
						case *ast.AssignStmt:
							if len(typedStatement.Rhs) != 1 {
								return "", false
							}
							rightCall, rightCallOK := typedStatement.Rhs[0].(*ast.CallExpr)
							if typedStatement.Tok == token.DEFINE && len(typedStatement.Lhs) == 2 && rightCallOK {
								if importPath, selectorName, ok := resolveImportedSelector(rightCall.Fun); ok && importPath == "strconv" && selectorName == "Atoi" {
									firstName, firstOK := typedStatement.Lhs[0].(*ast.Ident)
									secondName, secondOK := typedStatement.Lhs[1].(*ast.Ident)
									if !firstOK || !secondOK || firstName.Name == "" || secondName.Name == "" || firstName.Name == "_" || secondName.Name == "_" {
										return "", false
									}
									if len(rightCall.Args) != 1 {
										return "", false
									}
									translatedArgument, argumentKind, _, argumentOK := translateExpression(rightCall.Args[0], locals)
									if !argumentOK || argumentKind != "string" {
										return "", false
									}
									locals[firstName.Name] = "int"
									locals[secondName.Name] = "error"
									translatedStatements.WriteString(fmt.Sprintf("\tint %s = 0;\n", firstName.Name))
									translatedStatements.WriteString(fmt.Sprintf("\tint %s = tinygo_runtime_parse_i32(%s, &%s);\n", secondName.Name, translatedArgument, firstName.Name))
									continue
								}
								readStringSelector, readStringSelectorOK := rightCall.Fun.(*ast.SelectorExpr)
								if readStringSelectorOK && readStringSelector.Sel != nil && readStringSelector.Sel.Name == "ReadString" && len(rightCall.Args) == 1 {
									readerCall, readerCallOK := readStringSelector.X.(*ast.CallExpr)
									if !readerCallOK {
										return "", false
									}
									importPath, selectorName, ok := resolveImportedSelector(readerCall.Fun)
									if !ok || importPath != "bufio" || selectorName != "NewReader" || len(readerCall.Args) != 1 {
										return "", false
									}
									stdinImportPath, stdinSelectorName, ok := resolveImportedSelector(readerCall.Args[0])
									if !ok || stdinImportPath != "os" || stdinSelectorName != "Stdin" {
										return "", false
									}
									delimiterLiteral, ok := rightCall.Args[0].(*ast.BasicLit)
									if !ok || delimiterLiteral.Kind != token.CHAR || delimiterLiteral.Value != "'\\n'" {
										return "", false
									}
									firstName, firstOK := typedStatement.Lhs[0].(*ast.Ident)
									secondName, secondOK := typedStatement.Lhs[1].(*ast.Ident)
									if !firstOK || !secondOK || firstName.Name == "" || firstName.Name == "_" || secondName.Name != "_" {
										return "", false
									}
									locals[firstName.Name] = "string"
									translatedStatements.WriteString(fmt.Sprintf("\tchar %s[256];\n", firstName.Name))
									translatedStatements.WriteString(fmt.Sprintf("\ttinygo_runtime_read_line(%s, 256u);\n", firstName.Name))
									continue
								}
							}
							if len(typedStatement.Lhs) != 1 {
								return "", false
							}
							leftName, ok := typedStatement.Lhs[0].(*ast.Ident)
							if !ok || leftName.Name == "" {
								return "", false
							}
							translatedValue, translatedKind, _, translatedOK := translateExpression(typedStatement.Rhs[0], locals)
							if !translatedOK {
								return "", false
							}
							if typedStatement.Tok == token.DEFINE {
								if leftName.Name == "_" {
									return "", false
								}
								if translatedKind != "int" && translatedKind != "string" && translatedKind != "error" {
									return "", false
								}
								locals[leftName.Name] = translatedKind
								switch translatedKind {
								case "int", "error":
									translatedStatements.WriteString(fmt.Sprintf("\tint %s = %s;\n", leftName.Name, translatedValue))
								case "string":
									translatedStatements.WriteString(fmt.Sprintf("\tchar *%s = %s;\n", leftName.Name, translatedValue))
								default:
									return "", false
								}
								continue
							}
							compoundAssignToken, compoundAssignOK := runnableCompoundAssignToken(typedStatement.Tok)
							if typedStatement.Tok != token.ASSIGN && !compoundAssignOK {
								return "", false
							}
							if leftName.Name == "_" {
								continue
							}
							localKind, ok := locals[leftName.Name]
							leftSymbol := leftName.Name
							if !ok {
								if _, variableOK := topLevelVariables[leftName.Name]; !variableOK {
									return "", false
								}
								localKind, ok = topLevelVariableKinds[leftName.Name]
								if !ok {
									return "", false
								}
							}
							if localKind != translatedKind && !(localKind == "error" && translatedKind == "int") {
								return "", false
							}
							if compoundAssignOK {
								if localKind != "int" || translatedKind != "int" {
									return "", false
								}
								translatedStatements.WriteString(fmt.Sprintf("\t%s %s %s;\n", leftSymbol, compoundAssignToken, translatedValue))
								continue
							}
							translatedStatements.WriteString(fmt.Sprintf("\t%s = %s;\n", leftSymbol, translatedValue))
						case *ast.IncDecStmt:
							ident, ok := typedStatement.X.(*ast.Ident)
							if !ok || ident.Name == "" {
								return "", false
							}
							localKind, ok := locals[ident.Name]
							targetSymbol := ident.Name
							if !ok {
								if _, variableOK := topLevelVariables[ident.Name]; !variableOK {
									return "", false
								}
								localKind, ok = topLevelVariableKinds[ident.Name]
								if !ok {
									return "", false
								}
							}
							if localKind != "int" {
								return "", false
							}
							switch typedStatement.Tok {
							case token.INC:
								translatedStatements.WriteString(fmt.Sprintf("\t%s += 1;\n", targetSymbol))
							case token.DEC:
								translatedStatements.WriteString(fmt.Sprintf("\t%s -= 1;\n", targetSymbol))
							default:
								return "", false
							}
						case *ast.BranchStmt:
							if typedStatement.Label != nil || loopDepth == 0 {
								return "", false
							}
							switch typedStatement.Tok {
							case token.BREAK:
								translatedStatements.WriteString("\tbreak;\n")
							case token.CONTINUE:
								translatedStatements.WriteString("\tcontinue;\n")
							default:
								return "", false
							}
						case *ast.IfStmt:
							ifLocals := locals
							translatedInit := ""
							if typedStatement.Init != nil {
								ifLocals = cloneRunnableLocals(locals)
								var initOK bool
								translatedInit, initOK = translateRunnableInitStatement(typedStatement.Init, ifLocals, translateExpression)
								if !initOK {
									return "", false
								}
							}
							translatedCondition, conditionKind, _, conditionOK := translateExpression(typedStatement.Cond, ifLocals)
							if !conditionOK || conditionKind != "int" {
								return "", false
							}
							translatedBody, bodyOK := translateStatementList(typedStatement.Body.List, ifLocals, functionReturnKind, loopDepth)
							if !bodyOK {
								return "", false
							}
							if typedStatement.Init != nil {
								translatedStatements.WriteString("\t{\n")
								translatedStatements.WriteString(translatedInit)
							}
							translatedStatements.WriteString(fmt.Sprintf("\tif (%s) {\n%s\t}\n", translatedCondition, translatedBody))
							if typedStatement.Else != nil {
								switch typedElse := typedStatement.Else.(type) {
								case *ast.BlockStmt:
									translatedElse, elseOK := translateStatementList(typedElse.List, ifLocals, functionReturnKind, loopDepth)
									if !elseOK {
										return "", false
									}
									translatedStatements.WriteString(fmt.Sprintf("\telse {\n%s\t}\n", translatedElse))
								case *ast.IfStmt:
									translatedElse, elseOK := translateStatementList([]ast.Stmt{typedElse}, ifLocals, functionReturnKind, loopDepth)
									if !elseOK {
										return "", false
									}
									trimmedElse := strings.TrimPrefix(translatedElse, "\t")
									translatedStatements.WriteString("\telse ")
									translatedStatements.WriteString(trimmedElse)
								default:
									return "", false
								}
							}
							if typedStatement.Init != nil {
								translatedStatements.WriteString("\t}\n")
							}
						case *ast.ForStmt:
							loopLocals := map[string]string{}
							for name, kind := range locals {
								loopLocals[name] = kind
							}
							initFragment := ""
							if typedStatement.Init != nil {
								initAssign, ok := typedStatement.Init.(*ast.AssignStmt)
								if !ok || len(initAssign.Lhs) != 1 || len(initAssign.Rhs) != 1 {
									return "", false
								}
								leftName, ok := initAssign.Lhs[0].(*ast.Ident)
								if !ok || leftName.Name == "" || leftName.Name == "_" {
									return "", false
								}
								translatedValue, translatedKind, _, translatedOK := translateExpression(initAssign.Rhs[0], loopLocals)
								if !translatedOK || translatedKind != "int" {
									return "", false
								}
								switch initAssign.Tok {
								case token.DEFINE:
									if _, exists := loopLocals[leftName.Name]; exists {
										return "", false
									}
									loopLocals[leftName.Name] = "int"
									initFragment = fmt.Sprintf("int %s = %s", leftName.Name, translatedValue)
								case token.ASSIGN:
									localKind, ok := loopLocals[leftName.Name]
									if !ok || localKind != "int" {
										return "", false
									}
									initFragment = fmt.Sprintf("%s = %s", leftName.Name, translatedValue)
								default:
									return "", false
								}
							}
							conditionFragment := "1"
							if typedStatement.Cond != nil {
								translatedCondition, conditionKind, _, conditionOK := translateExpression(typedStatement.Cond, loopLocals)
								if !conditionOK || conditionKind != "int" {
									return "", false
								}
								conditionFragment = translatedCondition
							}
							postFragment := ""
							if typedStatement.Post != nil {
								switch postStatement := typedStatement.Post.(type) {
								case *ast.IncDecStmt:
									postIdent, ok := postStatement.X.(*ast.Ident)
									if !ok || postIdent.Name == "" {
										return "", false
									}
									postKind, ok := loopLocals[postIdent.Name]
									if !ok || postKind != "int" {
										return "", false
									}
									switch postStatement.Tok {
									case token.INC:
										postFragment = fmt.Sprintf("%s += 1", postIdent.Name)
									case token.DEC:
										postFragment = fmt.Sprintf("%s -= 1", postIdent.Name)
									default:
										return "", false
									}
								case *ast.AssignStmt:
									compoundAssignToken, compoundAssignOK := runnableCompoundAssignToken(postStatement.Tok)
									if len(postStatement.Lhs) != 1 || len(postStatement.Rhs) != 1 || (postStatement.Tok != token.ASSIGN && !compoundAssignOK) {
										return "", false
									}
									postName, ok := postStatement.Lhs[0].(*ast.Ident)
									if !ok || postName.Name == "" || postName.Name == "_" {
										return "", false
									}
									postKind, ok := loopLocals[postName.Name]
									if !ok || postKind != "int" {
										return "", false
									}
									translatedValue, translatedKind, _, translatedOK := translateExpression(postStatement.Rhs[0], loopLocals)
									if !translatedOK || translatedKind != "int" {
										return "", false
									}
									if compoundAssignOK {
										postFragment = fmt.Sprintf("%s %s %s", postName.Name, compoundAssignToken, translatedValue)
										break
									}
									postFragment = fmt.Sprintf("%s = %s", postName.Name, translatedValue)
								default:
									return "", false
								}
							}
							translatedBody, bodyOK := translateStatementList(typedStatement.Body.List, loopLocals, functionReturnKind, loopDepth+1)
							if !bodyOK {
								return "", false
							}
							translatedStatements.WriteString(fmt.Sprintf("\tfor (%s; %s; %s) {\n%s\t}\n", initFragment, conditionFragment, postFragment, translatedBody))
						case *ast.SwitchStmt:
							if typedStatement.Body == nil {
								return "", false
							}
							switchLocals := locals
							translatedInit := ""
							if typedStatement.Init != nil {
								switchLocals = cloneRunnableLocals(locals)
								var initOK bool
								translatedInit, initOK = translateRunnableInitStatement(typedStatement.Init, switchLocals, translateExpression)
								if !initOK {
									return "", false
								}
							}
							tagValue := ""
							tagKind := "int"
							if typedStatement.Tag != nil {
								translatedTag, translatedTagKind, _, tagOK := translateExpression(typedStatement.Tag, switchLocals)
								if !tagOK || (translatedTagKind != "int" && translatedTagKind != "string") {
									return "", false
								}
								tagValue = translatedTag
								tagKind = translatedTagKind
							}
							type translatedCaseClause struct {
								condition string
								body      string
							}
							translatedCases := make([]translatedCaseClause, 0, len(typedStatement.Body.List))
							defaultBody := ""
							for _, statement := range typedStatement.Body.List {
								caseClause, ok := statement.(*ast.CaseClause)
								if !ok {
									return "", false
								}
								caseLocals := map[string]string{}
								for name, kind := range switchLocals {
									caseLocals[name] = kind
								}
								translatedBody, bodyOK := translateStatementList(caseClause.Body, caseLocals, functionReturnKind, loopDepth)
								if !bodyOK {
									return "", false
								}
								if len(caseClause.List) == 0 {
									if defaultBody != "" {
										return "", false
									}
									defaultBody = translatedBody
									continue
								}
								conditions := make([]string, 0, len(caseClause.List))
								for _, caseExpression := range caseClause.List {
									translatedCase, translatedCaseKind, _, caseOK := translateExpression(caseExpression, switchLocals)
									if !caseOK || translatedCaseKind != tagKind {
										return "", false
									}
									if typedStatement.Tag == nil {
										if translatedCaseKind != "int" {
											return "", false
										}
										conditions = append(conditions, fmt.Sprintf("(%s)", translatedCase))
										continue
									}
									translatedCondition, conditionOK := runnableTaggedCaseCondition(tagValue, tagKind, translatedCase)
									if !conditionOK {
										return "", false
									}
									conditions = append(conditions, translatedCondition)
								}
								if len(conditions) == 0 {
									return "", false
								}
								translatedCases = append(translatedCases, translatedCaseClause{
									condition: strings.Join(conditions, " || "),
									body:      translatedBody,
								})
							}
							if typedStatement.Init != nil {
								translatedStatements.WriteString("\t{\n")
								translatedStatements.WriteString(translatedInit)
							}
							for caseIndex, translatedCase := range translatedCases {
								if caseIndex == 0 {
									translatedStatements.WriteString(fmt.Sprintf("\tif (%s) {\n%s\t}\n", translatedCase.condition, translatedCase.body))
									continue
								}
								translatedStatements.WriteString(fmt.Sprintf("\telse if (%s) {\n%s\t}\n", translatedCase.condition, translatedCase.body))
							}
							if defaultBody != "" {
								if len(translatedCases) == 0 {
									translatedStatements.WriteString(fmt.Sprintf("\t{\n%s\t}\n", defaultBody))
								} else {
									translatedStatements.WriteString(fmt.Sprintf("\telse {\n%s\t}\n", defaultBody))
								}
							}
							if typedStatement.Init != nil {
								translatedStatements.WriteString("\t}\n")
							}
						case *ast.ReturnStmt:
							if functionReturnKind != "void" {
								if len(typedStatement.Results) != 1 {
									return "", false
								}
								translatedResult, resultKind, _, resultOK := translateExpression(typedStatement.Results[0], locals)
								if !resultOK || resultKind != functionReturnKind {
									return "", false
								}
								translatedStatements.WriteString(fmt.Sprintf("\treturn %s;\n", translatedResult))
								continue
							}
							if len(typedStatement.Results) != 0 {
								return "", false
							}
							translatedStatements.WriteString("\treturn;\n")
						default:
							return "", false
						}
					}
					return translatedStatements.String(), true
				}
				generatedConstantDefinitions := make([]string, 0, len(constantOrder))
				for _, constantName := range constantOrder {
					generatedConstantDefinitions = append(generatedConstantDefinitions, topLevelFunctionDefinitions[constantName])
				}
				generatedVariableDefinitions := make([]string, 0, len(variableOrder))
				for _, variableName := range variableOrder {
					generatedVariableDefinitions = append(generatedVariableDefinitions, topLevelFunctionDefinitions[variableName])
				}
				generatedFunctionPrototypes := make([]string, 0, len(functionOrder))
				generatedImportedPrototypes := make([]string, 0)
				for _, importPath := range aliasToImportPath {
					importedFunctionMap, ok := importedRunnableFunctionsByPath[importPath]
					if !ok {
						continue
					}
					for _, functionName := range importedRunnableFunctionOrderByPath[importPath] {
						functionInfo, ok := importedFunctionMap[functionName]
						if !ok || functionInfo.Symbol == "" {
							supportsRunnableProgram = false
							break
						}
						returnType, ok := runnableReturnCType(functionInfo.ReturnKind)
						if !ok {
							supportsRunnableProgram = false
							break
						}
						generatedImportedPrototypes = append(generatedImportedPrototypes, fmt.Sprintf("%s %s(%s);\n", returnType, functionInfo.Symbol, formatRunnableParameterDecls(functionInfo.Parameters)))
					}
					if !supportsRunnableProgram {
						break
					}
				}
				generatedFunctionBodies := make([]string, 0, len(functionOrder))
				for _, functionName := range functionOrder {
					functionPrototype := topLevelFunctionDefinitions[functionName]
					if functionPrototype == "" {
						supportsRunnableProgram = false
						break
					}
					generatedFunctionPrototypes = append(generatedFunctionPrototypes, functionPrototype)
				}
				if supportsRunnableProgram {
					for _, functionName := range functionOrder {
						functionDecl, ok := functionDecls[functionName]
						if !ok || functionDecl == nil {
							supportsRunnableProgram = false
							break
						}
						locals := map[string]string{}
						for _, parameterName := range topLevelFunctionParameters[functionName] {
							locals[parameterName] = "int"
						}
						functionReturnKind, ok := topLevelFunctionReturnKinds[functionName]
						if !ok {
							supportsRunnableProgram = false
							break
						}
						translatedBody, bodyOK := translateStatementList(functionDecl.Body.List, locals, functionReturnKind, 0)
						if !bodyOK {
							supportsRunnableProgram = false
							break
						}
						if functionName == "main" {
							generatedFunctionBodies = append(generatedFunctionBodies, fmt.Sprintf("int main(void) {\n%s\treturn 0;\n}\n", translatedBody))
							continue
						}
						returnType, ok := runnableReturnCType(functionReturnKind)
						if !ok {
							supportsRunnableProgram = false
							break
						}
						generatedFunctionBodies = append(generatedFunctionBodies, fmt.Sprintf("static %s %s(%s) {\n%s}\n", returnType, functionName, formatRunnableParameterDecls(topLevelFunctionParameters[functionName]), translatedBody))
					}
				}
				if supportsRunnableProgram {
					loweredSourceContents.WriteString("\ntypedef unsigned int tinygo_wasi_size_t;\n")
					loweredSourceContents.WriteString("typedef unsigned int tinygo_wasi_errno_t;\n")
					loweredSourceContents.WriteString("typedef unsigned int tinygo_wasi_fd_t;\n")
					loweredSourceContents.WriteString("typedef struct {\n\tchar *buf;\n\ttinygo_wasi_size_t buf_len;\n} tinygo_wasi_iovec_t;\n")
					loweredSourceContents.WriteString("typedef struct {\n\tconst char *buf;\n\ttinygo_wasi_size_t buf_len;\n} tinygo_wasi_ciovec_t;\n")
					runtimeStorage := "static "
					if len(generatedImportedPrototypes) > 0 {
						runtimeStorage = ""
					}
					loweredSourceContents.WriteString("__attribute__((__import_module__(\"wasi_snapshot_preview1\"), __import_name__(\"fd_read\")))\n")
					loweredSourceContents.WriteString("extern tinygo_wasi_errno_t tinygo_runtime_fd_read_import(tinygo_wasi_fd_t fd, tinygo_wasi_iovec_t *iovs, tinygo_wasi_size_t iovs_len, tinygo_wasi_size_t *nread);\n")
					loweredSourceContents.WriteString("__attribute__((__import_module__(\"wasi_snapshot_preview1\"), __import_name__(\"fd_write\")))\n")
					loweredSourceContents.WriteString("extern tinygo_wasi_errno_t tinygo_runtime_fd_write_import(tinygo_wasi_fd_t fd, const tinygo_wasi_ciovec_t *iovs, tinygo_wasi_size_t iovs_len, tinygo_wasi_size_t *nwritten);\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%sunsigned int tinygo_runtime_fd_read(tinygo_wasi_fd_t fd, tinygo_wasi_iovec_t *iovs, tinygo_wasi_size_t iovs_len, tinygo_wasi_size_t *nread) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\treturn tinygo_runtime_fd_read_import(fd, iovs, iovs_len, nread);\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%sunsigned int tinygo_runtime_fd_write(tinygo_wasi_fd_t fd, const tinygo_wasi_ciovec_t *iovs, tinygo_wasi_size_t iovs_len, tinygo_wasi_size_t *nwritten) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\treturn tinygo_runtime_fd_write_import(fd, iovs, iovs_len, nwritten);\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%sint tinygo_runtime_is_space(char value) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\treturn value == ' ' || value == '\\n' || value == '\\r' || value == '\\t';\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%sunsigned int tinygo_runtime_read_line(char *buffer, tinygo_wasi_size_t capacity) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\tif (capacity == 0u) {\n")
					loweredSourceContents.WriteString("\t\treturn 0u;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\ttinygo_wasi_size_t length = 0u;\n")
					loweredSourceContents.WriteString("\twhile (length + 1u < capacity) {\n")
					loweredSourceContents.WriteString("\t\ttinygo_wasi_iovec_t iovec = { buffer + length, 1u };\n")
					loweredSourceContents.WriteString("\t\ttinygo_wasi_size_t nread = 0u;\n")
					loweredSourceContents.WriteString("\t\tif (tinygo_runtime_fd_read(0u, &iovec, 1u, &nread) != 0u || nread == 0u) {\n")
					loweredSourceContents.WriteString("\t\t\tbreak;\n")
					loweredSourceContents.WriteString("\t\t}\n")
					loweredSourceContents.WriteString("\t\tif (buffer[length] == '\\n') {\n")
					loweredSourceContents.WriteString("\t\t\tlength += 1u;\n")
					loweredSourceContents.WriteString("\t\t\tbreak;\n")
					loweredSourceContents.WriteString("\t\t}\n")
					loweredSourceContents.WriteString("\t\tlength += 1u;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\tbuffer[length] = '\\0';\n")
					loweredSourceContents.WriteString("\treturn length;\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%schar *tinygo_runtime_trim_space(char *value) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\twhile (*value != '\\0' && tinygo_runtime_is_space(*value)) {\n")
					loweredSourceContents.WriteString("\t\tvalue += 1;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\ttinygo_wasi_size_t length = 0u;\n")
					loweredSourceContents.WriteString("\twhile (value[length] != '\\0') {\n")
					loweredSourceContents.WriteString("\t\tlength += 1u;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\twhile (length > 0u && tinygo_runtime_is_space(value[length - 1u])) {\n")
					loweredSourceContents.WriteString("\t\tvalue[length - 1u] = '\\0';\n")
					loweredSourceContents.WriteString("\t\tlength -= 1u;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\treturn value;\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%sint tinygo_runtime_parse_i32(char *value, int *out) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\ttinygo_wasi_size_t index = 0u;\n")
					loweredSourceContents.WriteString("\tint negative = 0;\n")
					loweredSourceContents.WriteString("\tint parsed = 0;\n")
					loweredSourceContents.WriteString("\tif (value[0] == '\\0') {\n")
					loweredSourceContents.WriteString("\t\t*out = 0;\n")
					loweredSourceContents.WriteString("\t\treturn 1;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\tif (value[index] == '-' || value[index] == '+') {\n")
					loweredSourceContents.WriteString("\t\tnegative = value[index] == '-';\n")
					loweredSourceContents.WriteString("\t\tindex += 1u;\n")
					loweredSourceContents.WriteString("\t\tif (value[index] == '\\0') {\n")
					loweredSourceContents.WriteString("\t\t\t*out = 0;\n")
					loweredSourceContents.WriteString("\t\t\treturn 1;\n")
					loweredSourceContents.WriteString("\t\t}\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\tfor (; value[index] != '\\0'; index += 1u) {\n")
					loweredSourceContents.WriteString("\t\tchar digit = value[index];\n")
					loweredSourceContents.WriteString("\t\tif (digit < '0' || digit > '9') {\n")
					loweredSourceContents.WriteString("\t\t\t*out = 0;\n")
					loweredSourceContents.WriteString("\t\t\treturn 1;\n")
					loweredSourceContents.WriteString("\t\t}\n")
					loweredSourceContents.WriteString("\t\tparsed = (parsed * 10) + (digit - '0');\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\tif (negative) {\n")
					loweredSourceContents.WriteString("\t\tparsed = 0 - parsed;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\t*out = parsed;\n")
					loweredSourceContents.WriteString("\treturn 0;\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%svoid tinygo_runtime_write(const char *value, tinygo_wasi_size_t len) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\ttinygo_wasi_ciovec_t iovec = { value, len };\n")
					loweredSourceContents.WriteString("\ttinygo_wasi_size_t nwritten = 0u;\n")
					loweredSourceContents.WriteString("\t(void)tinygo_runtime_fd_write(1u, &iovec, 1u, &nwritten);\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%svoid tinygo_runtime_print_newline(void) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\ttinygo_runtime_write(\"\\n\", 1u);\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%sint tinygo_runtime_string_len(char *value) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\tint len = 0;\n")
					loweredSourceContents.WriteString("\twhile (value[len] != '\\0') {\n")
					loweredSourceContents.WriteString("\t\tlen += 1;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\treturn len;\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%sint tinygo_runtime_string_equal(const char *left, const char *right) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\tint index = 0;\n")
					loweredSourceContents.WriteString("\twhile (left[index] != '\\0' && right[index] != '\\0') {\n")
					loweredSourceContents.WriteString("\t\tif (left[index] != right[index]) {\n")
					loweredSourceContents.WriteString("\t\t\treturn 0;\n")
					loweredSourceContents.WriteString("\t\t}\n")
					loweredSourceContents.WriteString("\t\tindex += 1;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\treturn left[index] == right[index];\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%svoid tinygo_runtime_print_literal(const char *value, tinygo_wasi_size_t len, int newline) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\ttinygo_runtime_write(value, len);\n")
					loweredSourceContents.WriteString("\tif (newline != 0) {\n")
					loweredSourceContents.WriteString("\t\ttinygo_runtime_print_newline();\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%svoid tinygo_runtime_print_string(const char *value, int newline) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\ttinygo_wasi_size_t len = 0u;\n")
					loweredSourceContents.WriteString("\twhile (value[len] != '\\0') {\n")
					loweredSourceContents.WriteString("\t\tlen += 1u;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\ttinygo_runtime_write(value, len);\n")
					loweredSourceContents.WriteString("\tif (newline != 0) {\n")
					loweredSourceContents.WriteString("\t\ttinygo_runtime_print_newline();\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("}\n")
					loweredSourceContents.WriteString(fmt.Sprintf("%svoid tinygo_runtime_print_i32(int value, int newline) {\n", runtimeStorage))
					loweredSourceContents.WriteString("\tchar buffer[32];\n")
					loweredSourceContents.WriteString("\tunsigned int index = 0u;\n")
					loweredSourceContents.WriteString("\tunsigned int magnitude = 0u;\n")
					loweredSourceContents.WriteString("\tchar digits[32];\n")
					loweredSourceContents.WriteString("\tunsigned int digitCount = 0u;\n")
					loweredSourceContents.WriteString("\tif (value == 0) {\n")
					loweredSourceContents.WriteString("\t\ttinygo_runtime_write(\"0\", 1u);\n")
					loweredSourceContents.WriteString("\t\tif (newline != 0) {\n")
					loweredSourceContents.WriteString("\t\t\ttinygo_runtime_print_newline();\n")
					loweredSourceContents.WriteString("\t\t}\n")
					loweredSourceContents.WriteString("\t\treturn;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\tif (value < 0) {\n")
					loweredSourceContents.WriteString("\t\tbuffer[index++] = '-';\n")
					loweredSourceContents.WriteString("\t\tmagnitude = (unsigned int)(0 - value);\n")
					loweredSourceContents.WriteString("\t} else {\n")
					loweredSourceContents.WriteString("\t\tmagnitude = (unsigned int)value;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\twhile (magnitude > 0u) {\n")
					loweredSourceContents.WriteString("\t\tdigits[digitCount++] = (char)('0' + (magnitude % 10u));\n")
					loweredSourceContents.WriteString("\t\tmagnitude /= 10u;\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\twhile (digitCount > 0u) {\n")
					loweredSourceContents.WriteString("\t\tbuffer[index++] = digits[--digitCount];\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("\ttinygo_runtime_write(buffer, index);\n")
					loweredSourceContents.WriteString("\tif (newline != 0) {\n")
					loweredSourceContents.WriteString("\t\ttinygo_runtime_print_newline();\n")
					loweredSourceContents.WriteString("\t}\n")
					loweredSourceContents.WriteString("}\n")
					for _, constantDefinition := range generatedConstantDefinitions {
						loweredSourceContents.WriteString(constantDefinition)
					}
					for _, variableDefinition := range generatedVariableDefinitions {
						loweredSourceContents.WriteString(variableDefinition)
					}
					for _, functionPrototype := range generatedFunctionPrototypes {
						loweredSourceContents.WriteString(functionPrototype)
					}
					for _, functionPrototype := range generatedImportedPrototypes {
						loweredSourceContents.WriteString(functionPrototype)
					}
					for _, functionBody := range generatedFunctionBodies {
						loweredSourceContents.WriteString(functionBody)
					}
					runnableEntrypoint := "main"
					runnableLoweredArtifactEntrypoint = &runnableEntrypoint
					runnableLoweredArtifactKind = "execution"
					runnableLoweredArtifactReason = ""
					runnableLoweredArtifact = true
					runnableCommandArtifactEntrypoint = &runnableEntrypoint
					runnableCommandArtifactKind = "execution"
					runnableCommandArtifactReason = ""
					runnableCommandArtifact = true
				}
			}
		}
		loweredIRUnits = append(loweredIRUnits, LoweredIRUnit{
			ID:                loweredUnit.ID,
			Kind:              loweredUnit.Kind,
			ImportPath:        loweredUnit.ImportPath,
			ModulePath:        loweredUnit.ModulePath,
			PackageDir:        loweredUnit.PackageDir,
			SourceFiles:       append([]string{}, loweredUnit.SourceFiles...),
			LoweredSourcePath: loweredUnit.LoweredSourcePath,
			PackageName:       packageName,
			Imports:           append([]LoweredIRImport{}, imports...),
			Functions:         append([]LoweredIRFunction{}, functions...),
			Types:             append([]LoweredIRType{}, types...),
			Constants:         append([]LoweredIRConstant{}, constants...),
			Variables:         append([]LoweredIRVariable{}, variables...),
			Declarations:      append([]LoweredIRDeclaration{}, declarations...),
			PlaceholderBlocks: append([]LoweredIRLoweringBlock{}, placeholderBlocks...),
			LoweringBlocks:    append([]LoweredIRLoweringBlock{}, loweringBlocks...),
		})
		generatedFiles = append(generatedFiles, GeneratedFile{
			Path:     loweredUnit.LoweredSourcePath,
			Contents: loweredSourceContents.String(),
		})
	}

	loweredIRManifestContents, err := json.Marshal(LoweredIRManifest{
		EntryFile:    input.EntryFile,
		OptimizeFlag: optimizeFlag,
		Units:        append([]LoweredIRUnit{}, loweredIRUnits...),
	})
	if err != nil {
		return Result{}, err
	}
	generatedFiles = append(generatedFiles, GeneratedFile{
		Path:     "/working/tinygo-lowered-ir.json",
		Contents: string(loweredIRManifestContents),
	})

	compileCommands := make([]CommandInvocation, 0, len(input.CompileJobs))
	loweredCompileCommands := make([]CommandInvocation, 0, len(input.CompileJobs))
	loweredObjectFiles := make([]string, 0, len(input.CompileJobs))
	executionLinkJob := input.LinkJob
	if input.ExecutionLinkJob != nil {
		executionLinkJob = *input.ExecutionLinkJob
	}
	linkBitcodeInputs := append([]string{}, input.LinkJob.BitcodeInputs...)
	if len(linkBitcodeInputs) == 0 {
		linkBitcodeInputs = make([]string, 0, len(input.CompileJobs))
		for _, compileJob := range input.CompileJobs {
			if compileJob.BitcodeOutputPath == "" {
				return Result{}, fmt.Errorf("bitcode output path is required for compile job %s", compileJob.ID)
			}
			linkBitcodeInputs = append(linkBitcodeInputs, compileJob.BitcodeOutputPath)
		}
	}
	executionLinkBitcodeInputs := append([]string{}, executionLinkJob.BitcodeInputs...)
	if len(executionLinkBitcodeInputs) == 0 {
		executionLinkBitcodeInputs = make([]string, 0, len(input.CompileJobs))
		for _, compileJob := range input.CompileJobs {
			if compileJob.BitcodeOutputPath == "" {
				return Result{}, fmt.Errorf("bitcode output path is required for compile job %s", compileJob.ID)
			}
			executionLinkBitcodeInputs = append(executionLinkBitcodeInputs, compileJob.BitcodeOutputPath)
		}
	}
	for _, compileJob := range input.CompileJobs {
		loweredUnit, ok := loweredUnitsByID[compileJob.ID]
		if !ok || loweredUnit.LoweredSourcePath == "" {
			return Result{}, fmt.Errorf("lowered unit is required for compile job %s", compileJob.ID)
		}
		loweredObjectPath := loweredUnit.LoweredSourcePath
		if strings.HasSuffix(loweredObjectPath, ".c") {
			loweredObjectPath = strings.TrimSuffix(loweredObjectPath, ".c") + ".o"
		} else {
			loweredObjectPath += ".o"
		}
		loweredCommandArgv := []string{
			"/usr/bin/clang",
			"--target=" + compileJob.LLVMTarget,
		}
		if compileJob.OptimizeFlag != "" {
			loweredCommandArgv = append(loweredCommandArgv, compileJob.OptimizeFlag)
		}
		loweredCommandArgv = append(loweredCommandArgv, compileJob.CFlags...)
		loweredCommandArgv = append(loweredCommandArgv, "-c", loweredUnit.LoweredSourcePath, "-o", loweredObjectPath)
		loweredCompileCommands = append(loweredCompileCommands, CommandInvocation{
			Argv: loweredCommandArgv,
			Cwd:  "/working",
		})
		loweredObjectFiles = append(loweredObjectFiles, loweredObjectPath)
		commandArgv := []string{
			"/usr/bin/clang",
			"--target=" + compileJob.LLVMTarget,
		}
		if compileJob.OptimizeFlag != "" {
			commandArgv = append(commandArgv, compileJob.OptimizeFlag)
		}
		commandArgv = append(commandArgv, compileJob.CFlags...)
		commandArgv = append(commandArgv, "-emit-llvm", "-c", loweredUnit.LoweredSourcePath, "-o", compileJob.BitcodeOutputPath)
		compileCommands = append(compileCommands, CommandInvocation{
			Argv: commandArgv,
			Cwd:  "/working",
		})
	}

	linkCommandArgv := []string{
		"/usr/bin/" + executionLinkJob.Linker,
	}
	executionLDFlags := append([]string{}, executionLinkJob.LDFlags...)
	if runnableCommandArtifactEntrypoint != nil && *runnableCommandArtifactEntrypoint == "main" {
		hasNoEntry := false
		hasMainExport := false
		for _, flag := range executionLDFlags {
			if flag == "--no-entry" {
				hasNoEntry = true
			}
			if flag == "--export=main" || flag == "--export-all" {
				hasMainExport = true
			}
		}
		if !hasNoEntry {
			executionLDFlags = append(executionLDFlags, "--no-entry")
		}
		if !hasMainExport {
			executionLDFlags = append(executionLDFlags, "--export=main")
		}
	}
	linkCommandArgv = append(linkCommandArgv, executionLDFlags...)
	linkCommandArgv = append(linkCommandArgv, executionLinkBitcodeInputs...)
	linkCommandArgv = append(linkCommandArgv, "-o", executionLinkJob.ArtifactOutputPath)

	commandBatchManifestContents, err := json.Marshal(CommandBatchManifest{
		CompileCommands: compileCommands,
		LinkCommand: CommandInvocation{
			Argv: linkCommandArgv,
			Cwd:  "/working",
		},
	})
	if err != nil {
		return Result{}, err
	}
	loweredLinkCommandArgv := []string{
		"/usr/bin/" + input.LinkJob.Linker,
	}
	loweredLDFlags := append([]string{}, input.LinkJob.LDFlags...)
	if runnableLoweredArtifactEntrypoint != nil && *runnableLoweredArtifactEntrypoint == "main" {
		hasNoEntry := false
		hasMainExport := false
		for _, flag := range loweredLDFlags {
			if flag == "--no-entry" {
				hasNoEntry = true
			}
			if flag == "--export=main" || flag == "--export-all" {
				hasMainExport = true
			}
		}
		if !hasNoEntry {
			loweredLDFlags = append(loweredLDFlags, "--no-entry")
		}
		if !hasMainExport {
			loweredLDFlags = append(loweredLDFlags, "--export=main")
		}
	}
	loweredLinkCommandArgv = append(loweredLinkCommandArgv, loweredLDFlags...)
	loweredLinkCommandArgv = append(loweredLinkCommandArgv, loweredObjectFiles...)
	loweredLinkCommandArgv = append(loweredLinkCommandArgv, "-o", "/working/tinygo-lowered-out.wasm")
	loweredCommandBatchManifestContents, err := json.Marshal(CommandBatchManifest{
		CompileCommands: loweredCompileCommands,
		LinkCommand: CommandInvocation{
			Argv: loweredLinkCommandArgv,
			Cwd:  "/working",
		},
	})
	if err != nil {
		return Result{}, err
	}
	loweredArtifactManifestContents, err := json.Marshal(LoweredArtifactManifest{
		ArtifactOutputPath: "/working/tinygo-lowered-out.wasm",
		ArtifactKind:       runnableLoweredArtifactKind,
		Entrypoint:         runnableLoweredArtifactEntrypoint,
		ObjectFiles:        loweredObjectFiles,
		Reason:             runnableLoweredArtifactReason,
		Runnable:           runnableLoweredArtifact,
	})
	if err != nil {
		return Result{}, err
	}
	commandArtifactManifestContents, err := json.Marshal(CommandArtifactManifest{
		ArtifactOutputPath: executionLinkJob.ArtifactOutputPath,
		ArtifactKind:       runnableCommandArtifactKind,
		BitcodeFiles:       append([]string{}, executionLinkBitcodeInputs...),
		Entrypoint:         runnableCommandArtifactEntrypoint,
		Reason:             runnableCommandArtifactReason,
		Runnable:           runnableCommandArtifact,
	})
	if err != nil {
		return Result{}, err
	}

	return Result{
		OK: true,
		GeneratedFiles: append(generatedFiles,
			GeneratedFile{
				Path:     "/working/tinygo-lowered-command-batch.json",
				Contents: string(loweredCommandBatchManifestContents),
			},
			GeneratedFile{
				Path:     "/working/tinygo-lowered-artifact.json",
				Contents: string(loweredArtifactManifestContents),
			},
			GeneratedFile{
				Path:     "/working/tinygo-command-artifact.json",
				Contents: string(commandArtifactManifestContents),
			},
			GeneratedFile{
				Path:     "/working/tinygo-command-batch.json",
				Contents: string(commandBatchManifestContents),
			},
		),
		Diagnostics: []string{
			fmt.Sprintf("tinygo backend prepared %d compile jobs", len(input.CompileJobs)),
		},
	}, nil
}

func ExecutePaths(inputPath, resultPath string) error {
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return err
	}

	var input Input
	if err := json.Unmarshal(inputData, &input); err != nil {
		return err
	}

	result, err := Build(input)
	if err != nil {
		failedResult := Result{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(failedResult)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}

	resultData, err := json.Marshal(result)
	if err != nil {
		return err
	}

	return os.WriteFile(resultPath, resultData, 0o644)
}
