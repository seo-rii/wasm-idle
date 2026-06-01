package org.jetbrains.kotlin.util;

import java.util.List;
import kotlin.Pair;
import kotlin.jvm.functions.Function0;
import org.jetbrains.kotlin.platform.TargetPlatform;

public abstract class PerformanceManager {
	public static final PerformanceManager$Companion Companion = null;

	private final TargetPlatform targetPlatform;
	private final String presentableName;
	private CompilerType compilerType = CompilerType.K2;
	private boolean detailedPerf;
	private boolean hasErrors;
	private String targetDescription;
	private String outputKind;
	private int files;
	private int lines;

	public PerformanceManager(TargetPlatform targetPlatform, String presentableName) {
		this.targetPlatform = targetPlatform;
		this.presentableName = presentableName;
	}

	public final TargetPlatform getTargetPlatform() {
		return targetPlatform;
	}

	public final String getPresentableName() {
		return presentableName;
	}

	public final boolean isExtendedStatsEnabled() {
		return false;
	}

	public final CompilerType getCompilerType() {
		return compilerType;
	}

	public final void setCompilerType(CompilerType compilerType) {
		this.compilerType = compilerType;
	}

	public final boolean getHasErrors() {
		return hasErrors;
	}

	public final String getTargetDescription() {
		return targetDescription;
	}

	public final void setTargetDescription(String targetDescription) {
		this.targetDescription = targetDescription;
	}

	public final String getOutputKind() {
		return outputKind;
	}

	public final void setOutputKind(String outputKind) {
		this.outputKind = outputKind;
	}

	public final int getFiles() {
		return files;
	}

	public final int getLines() {
		return lines;
	}

	public final boolean isFinalized() {
		return false;
	}

	public final boolean isPhaseMeasuring() {
		return false;
	}

	public final boolean getDetailedPerf() {
		return detailedPerf;
	}

	public final void setDetailedPerf(boolean detailedPerf) {
		this.detailedPerf = detailedPerf;
	}

	public final String getTargetInfo() {
		return presentableName;
	}

	public final void initializeCurrentThread() {}

	public final UnitStats getUnitStats() {
		return null;
	}

	public final void addOtherUnitStats(UnitStats unitStats) {}

	public final void enableExtendedStats() {}

	public void addSourcesStats(int files, int lines) {
		this.files += files;
		this.lines += lines;
	}

	public final void notifyDynamicPhaseStarted(String name) {}

	public final void notifyDynamicPhaseFinished(String name, PhaseType phaseType) {}

	public final void notifyPhaseStarted(PhaseType phaseType) {}

	public final void notifyPhaseFinished(PhaseType phaseType) {}

	public void notifyCompilationFinished() {}

	public final void notifyCurrentPhaseFinishedIfNeeded() {}

	public final <T> T measureSideTime$compiler_common(
		PhaseSideType sideType,
		Function0<? extends T> action
	) {
		return action.invoke();
	}

	public final void registerKlibElementStats(List<Pair<String, Long>> stats) {}

	public final void dumpPerformanceReport(String path) {}

	public final String createPerformanceReport(PerformanceManager$DumpFormat format) {
		return "";
	}
}
