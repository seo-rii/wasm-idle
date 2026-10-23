<script lang="ts">
	import {
		cVersions,
		clangCompilerLanguages,
		compilerArgumentConfig,
		optimizationLevels,
		type CompilerSettings
	} from './compilerOptions';
	import type { PlaygroundLanguage } from './language-registry';

	let {
		language,
		settings,
		error,
		onchange
	}: {
		language: PlaygroundLanguage;
		settings: CompilerSettings;
		error: string | null;
		onchange: (settings: CompilerSettings) => void;
	} = $props();
	const config = $derived(compilerArgumentConfig[language]);
	const clang = $derived(clangCompilerLanguages.has(language));
	function update<K extends keyof CompilerSettings>(key: K, value: CompilerSettings[K]) {
		onchange({ ...settings, [key]: value });
	}
</script>

{#if config}
	<details class="compiler-options">
		<summary
			>Compile options{#if settings.arguments || settings.optimization !== 'default' || settings.warnings !== 'default' || settings.warningsAsErrors || settings.pedantic || !settings.gnuExtensions}<span
					>Customized</span
				>{/if}</summary
		>
		<div class="compiler-options__body">
			{#if clang}
				<div class="compiler-options__selections">
					{#if language === 'C' || language === 'OBJC'}
						<label
							>C standard
							<select
								aria-label="C standard"
								value={settings.cVersion}
								onchange={(event) =>
									update(
										'cVersion',
										event.currentTarget.value as CompilerSettings['cVersion']
									)}
							>
								{#each cVersions as version (version)}<option value={version}
										>{version === 'C2Y' ? 'C2y (draft)' : version}</option
									>{/each}
							</select>
						</label>
					{/if}
					<label
						>Optimization
						<select
							aria-label="Optimization"
							value={settings.optimization}
							onchange={(event) =>
								update(
									'optimization',
									event.currentTarget.value as CompilerSettings['optimization']
								)}
						>
							{#each optimizationLevels as level (level)}<option value={level}
									>{level === 'default'
										? 'Runtime default'
										: `-O${level}`}</option
								>{/each}
						</select>
					</label>
					<label
						>Warnings
						<select
							aria-label="Warnings"
							value={settings.warnings}
							onchange={(event) =>
								update(
									'warnings',
									event.currentTarget.value as CompilerSettings['warnings']
								)}
						>
							<option value="default">Default</option><option value="all"
								>-Wall</option
							><option value="extra">-Wall -Wextra</option><option value="none"
								>Suppress (-w)</option
							>
						</select>
					</label>
					<label class="check"
						><input
							type="checkbox"
							checked={settings.warningsAsErrors}
							onchange={(event) =>
								update('warningsAsErrors', event.currentTarget.checked)}
						/>Warnings as errors (-Werror)</label
					>
					<label class="check"
						><input
							type="checkbox"
							checked={settings.pedantic}
							onchange={(event) => update('pedantic', event.currentTarget.checked)}
						/>Strict diagnostics (-pedantic)</label
					>
					<label class="check"
						><input
							type="checkbox"
							checked={settings.gnuExtensions}
							onchange={(event) =>
								update('gnuExtensions', event.currentTarget.checked)}
						/>GNU extensions</label
					>
				</div>
			{/if}
			<label class="compiler-options__arguments"
				>{config.label}
				<input
					aria-label={config.label}
					value={settings.arguments}
					placeholder={config.placeholder}
					spellcheck={false}
					aria-invalid={!!error}
					aria-describedby="compiler-options-help"
					oninput={(event) => update('arguments', event.currentTarget.value)}
				/>
			</label>
			<p id="compiler-options-help">
				{config.help}
				{#if language !== 'HASKELL'}Use quotes to group spaces in an argument.{/if}
			</p>
			{#if clang}<p>LLDB debug builds always use -O0 and debug information.</p>{/if}
			{#if error}<p role="alert">{error}</p>{/if}
		</div>
	</details>
{/if}

<style>
	.compiler-options {
		border-bottom: 1px solid var(--line);
		background: var(--surface);
		color: var(--text);
	}
	summary {
		cursor: pointer;
		padding: 8px 18px;
		font-weight: 600;
	}
	summary:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}
	summary span {
		margin-left: 10px;
		color: var(--primary);
		font-size: 11px;
	}
	.compiler-options__body {
		display: grid;
		gap: 10px;
		padding: 4px 18px 14px;
	}
	.compiler-options__selections {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 18px;
		align-items: end;
	}
	label {
		display: grid;
		gap: 5px;
		font-size: 12px;
		font-weight: 600;
	}
	select,
	input {
		box-sizing: border-box;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--fill);
		color: var(--text);
		padding: 6px 8px;
		font: inherit;
	}
	select:focus-visible,
	input:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 1px;
	}
	.check {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 7px 0;
	}
	.check input {
		accent-color: var(--primary);
	}
	.compiler-options__arguments input {
		width: 100%;
		font-family: 'JetBrains Mono', monospace;
	}
	p {
		margin: 0;
		color: var(--text-3);
		font-size: 12px;
	}
	p[role='alert'] {
		color: var(--danger-text);
	}
</style>
