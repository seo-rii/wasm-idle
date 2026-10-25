import { createCrossGccWorker } from '@wasm-idle/gcc';

const element = (id) => document.getElementById(id);
let activeController, downloadUrl;

function clearDownload() {
	if (downloadUrl) URL.revokeObjectURL(downloadUrl);
	downloadUrl = undefined;
	element('download').hidden = true;
	element('download').removeAttribute('href');
}

element('cancel').addEventListener('click', () => activeController?.abort());
element('form').addEventListener('submit', async (event) => {
	event.preventDefault();
	if (activeController) return;
	const manifestUrl = element('manifest').value.trim();
	const manifestSha256 = element('sha256').value.trim();
	const request = {
		code: element('source').value,
		language: element('language').value,
		cpu: element('cpu').value,
		emit: element('emit').value,
		optimization: element('optimization').value
	};
	clearDownload();
	element('diagnostics').hidden = true;
	element('diagnostics').textContent = '';
	element('compile').disabled = true;
	element('cancel').disabled = false;
	activeController = new AbortController();
	let compiler;
	const started = performance.now();
	try {
		element('status').textContent = 'Verifying and loading the GCC bundle…';
		compiler = await createCrossGccWorker({
			manifestUrl,
			manifestSha256,
			signal: activeController.signal
		});
		element('status').textContent =
			`Compiling with GCC ${compiler.identity.compilerVersion} (${compiler.manifest.qualification.status} producer qualification)…`;
		const result = await compiler.compile(request, { signal: activeController.signal });
		element('diagnostics').textContent = [
			result.stdout,
			result.stderr,
			...result.stages.map(
				(stage) =>
					`${stage.tool}: exit ${stage.exitCode}, ${stage.milliseconds.toFixed(0)} ms, ${(stage.peakMemoryBytes / 1048576).toFixed(1)} MiB Wasm memory`
			)
		]
			.filter(Boolean)
			.join('\n');
		element('diagnostics').hidden = false;
		if (result.exitCode !== 0 || !result.artifact) {
			element('status').textContent = `Compilation failed (exit ${result.exitCode}).`;
			return;
		}
		const artifact = result.artifact;
		downloadUrl = URL.createObjectURL(
			new Blob([artifact.bytes], {
				type: artifact.format === 'assembly' ? 'text/plain' : 'application/octet-stream'
			})
		);
		const download = element('download');
		download.href = downloadUrl;
		download.download = artifact.fileName;
		download.textContent = `Download ${artifact.fileName}`;
		download.hidden = false;
		element('status').textContent =
			`${artifact.format} · ${artifact.bytes.length.toLocaleString()} bytes · ${((performance.now() - started) / 1000).toFixed(1)} seconds including bundle loading.`;
	} catch (error) {
		clearDownload();
		element('status').textContent =
			error?.name === 'AbortError'
				? 'Compilation cancelled; the Worker was terminated.'
				: `Compilation failed: ${error?.message || error}`;
	} finally {
		compiler?.dispose();
		activeController = undefined;
		element('compile').disabled = false;
		element('cancel').disabled = true;
	}
});

window.addEventListener('beforeunload', () => {
	activeController?.abort();
	clearDownload();
});
