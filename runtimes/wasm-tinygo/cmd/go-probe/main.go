package main

import (
	"fmt"
	"os"

	"wasm-tinygo/internal/driver"
	"wasm-tinygo/internal/tinygobackend"
	"wasm-tinygo/internal/tinygofrontend"
)

func main() {
	driverRequestPath := os.Getenv("WASM_TINYGO_REQUEST_PATH")
	if driverRequestPath == "" {
		driverRequestPath = "/workspace/tinygo-request.json"
	}
	driverResultPath := os.Getenv("WASM_TINYGO_RESULT_PATH")
	if driverResultPath == "" {
		driverResultPath = "/workspace/tinygo-result.json"
	}
	frontendInputPath := os.Getenv("WASM_TINYGO_FRONTEND_INPUT_PATH")
	if frontendInputPath == "" {
		frontendInputPath = "/working/tinygo-frontend-input.json"
	}
	frontendResultPath := os.Getenv("WASM_TINYGO_FRONTEND_RESULT_PATH")
	if frontendResultPath == "" {
		frontendResultPath = "/working/tinygo-frontend-result.json"
	}
	frontendAnalysisPath := os.Getenv("WASM_TINYGO_FRONTEND_ANALYSIS_PATH")
	if frontendAnalysisPath == "" {
		frontendAnalysisPath = "/working/tinygo-frontend-analysis.json"
	}
	frontendRealAdapterPath := os.Getenv("WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH")
	if frontendRealAdapterPath == "" {
		frontendRealAdapterPath = "/working/tinygo-frontend-real-adapter.json"
	}
	backendInputPath := os.Getenv("WASM_TINYGO_BACKEND_INPUT_PATH")
	if backendInputPath == "" {
		backendInputPath = "/working/tinygo-backend-input.json"
	}
	backendResultPath := os.Getenv("WASM_TINYGO_BACKEND_RESULT_PATH")
	if backendResultPath == "" {
		backendResultPath = "/working/tinygo-backend-result.json"
	}

	switch os.Getenv("WASM_TINYGO_MODE") {
	case "frontend":
		consumedRealAdapter := false
		consumedAnalysis := false
		if _, err := os.Stat(frontendRealAdapterPath); err == nil {
			consumedRealAdapter = true
		}
		if _, err := os.Stat(frontendAnalysisPath); err == nil {
			consumedAnalysis = true
		}
		if err := tinygofrontend.ExecuteResultPaths(frontendInputPath, frontendAnalysisPath, frontendRealAdapterPath, frontendResultPath); err != nil {
			fmt.Println("tinygo frontend failed:", err)
			os.Exit(1)
		}
		if consumedRealAdapter {
			fmt.Println("tinygo frontend consuming real adapter handoff; tinygo frontend prepared bootstrap compile request")
			break
		}
		if consumedAnalysis {
			fmt.Println("tinygo frontend consuming analysis handoff; tinygo frontend prepared bootstrap compile request")
			break
		}
		fmt.Println("tinygo frontend prepared bootstrap compile request")
	case "frontend-analysis-build":
		if err := tinygofrontend.ExecuteAnalysisBuildPaths(frontendAnalysisPath, frontendResultPath); err != nil {
			fmt.Println("tinygo frontend failed:", err)
			os.Exit(1)
		}
		fmt.Println("tinygo frontend consuming analysis handoff; tinygo frontend prepared bootstrap compile request")
	case "frontend-real-adapter-build":
		if err := tinygofrontend.ExecuteAdapterBuildPaths(frontendAnalysisPath, frontendRealAdapterPath, frontendResultPath); err != nil {
			fmt.Println("tinygo frontend failed:", err)
			os.Exit(1)
		}
		fmt.Println("tinygo frontend consuming real adapter handoff; tinygo frontend prepared bootstrap compile request")
	case "frontend-analysis":
		if err := tinygofrontend.ExecuteAnalysisPaths(frontendInputPath, frontendAnalysisPath); err != nil {
			fmt.Println("tinygo frontend analysis failed:", err)
			os.Exit(1)
		}
		fmt.Println("tinygo frontend prepared analysis handoff")
	case "frontend-real-adapter":
		if err := tinygofrontend.ExecuteAdapterPaths(frontendInputPath, frontendRealAdapterPath); err != nil {
			fmt.Println("tinygo frontend real adapter failed:", err)
			os.Exit(1)
		}
		fmt.Println("tinygo frontend prepared real adapter handoff")
	case "frontend-real-adapter-analysis":
		if err := tinygofrontend.ExecuteAdapterAnalysisPaths(frontendAnalysisPath, frontendRealAdapterPath); err != nil {
			fmt.Println("tinygo frontend real adapter analysis failed:", err)
			os.Exit(1)
		}
		fmt.Println("tinygo frontend prepared real adapter handoff")
	case "backend":
		if err := tinygobackend.ExecutePaths(backendInputPath, backendResultPath); err != nil {
			fmt.Println("tinygo backend failed:", err)
			os.Exit(1)
		}
		fmt.Println("tinygo backend prepared command batch")
	default:
		if err := driver.ExecutePaths(driverRequestPath, driverResultPath); err != nil {
			fmt.Println("tinygo driver failed:", err)
			os.Exit(1)
		}
		fmt.Println("tinygo driver planned bootstrap build")
	}
}
