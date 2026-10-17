<script lang="ts">
	import type { ContainerWorkspaceEntry } from './protocol';
	import {
		buildExplorerModel,
		explorerBreadcrumbs,
		EXPLORER_PAGE_SIZE,
		resolveExplorerDirectory,
		visibleExplorerRows
	} from './explorer';

	interface Props {
		entries: readonly ContainerWorkspaceEntry[];
		selectedPath?: string;
		initialDirectory?: string;
		busy?: boolean;
		onOpenFile: (entry: ContainerWorkspaceEntry) => void;
	}

	let {
		entries,
		selectedPath,
		initialDirectory = '',
		busy = false,
		onOpenFile
	}: Props = $props();
	let requestedDirectory = $state('');
	let expanded = $state(new Set<string>());
	let offset = $state(0);
	const model = $derived(buildExplorerModel(entries));
	const directory = $derived(resolveExplorerDirectory(model, requestedDirectory));
	const breadcrumbs = $derived(explorerBreadcrumbs(directory));
	const visible = $derived(visibleExplorerRows(model, directory, expanded, offset));

	$effect(() => {
		requestedDirectory = initialDirectory;
		expanded = new Set();
		offset = 0;
	});

	function enterDirectory(path: string) {
		requestedDirectory = resolveExplorerDirectory(model, path);
		offset = 0;
	}

	function toggleDirectory(path: string) {
		const next = new Set(expanded);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		expanded = next;
		offset = 0;
	}
</script>

<div class="container-explorer">
	<nav aria-label="Workspace folder" class="breadcrumbs">
		<button
			type="button"
			class="parent-button"
			aria-label="Go to parent folder"
			title="Go to parent folder"
			disabled={!directory}
			onclick={() => enterDirectory(model.entries.get(directory)?.parent ?? '')}>↑</button
		>
		<ol>
			{#each breadcrumbs as crumb (crumb.path)}
				<li>
					<button
						type="button"
						title={crumb.path ? `/workspace/${crumb.path}` : '/workspace'}
						aria-current={crumb.path === directory ? 'location' : undefined}
						onclick={() => enterDirectory(crumb.path)}>{crumb.name}</button
					>
				</li>
			{/each}
		</ol>
	</nav>
	<div class="files">
		{#if visible.rows.length === 0}
			<p class="empty">This folder is empty.</p>
		{:else}
			<ul aria-label="Workspace files">
				{#each visible.rows as row (row.entry.path)}
					{@const entry = row.entry}
					<li style:padding-left={`${Math.min(row.depth, 16) * 12}px`}>
						{#if entry.type === 'directory'}
							<button
								type="button"
								class="toggle"
								aria-label={`${row.expanded ? 'Collapse' : 'Expand'} /workspace/${entry.path}`}
								aria-expanded={row.expanded}
								onclick={() => toggleDirectory(entry.path)}
								>{row.expanded ? '▾' : '▸'}</button
							>
							<button
								type="button"
								class="entry directory"
								data-container-directory={entry.path}
								aria-label={`Open folder /workspace/${entry.path}`}
								title={`/workspace/${entry.path}/`}
								onclick={() => enterDirectory(entry.path)}
							>
								<span class="material-symbols-outlined" aria-hidden="true"
									>folder</span
								>
								<span>{entry.name}</span>
							</button>
						{:else if entry.type === 'file'}
							<button
								type="button"
								class="entry file"
								class:active={entry.path === selectedPath}
								data-container-path={entry.path}
								aria-current={entry.path === selectedPath ? 'true' : undefined}
								title={`/workspace/${entry.path} (${entry.size} bytes)`}
								disabled={busy}
								onclick={() => onOpenFile(entry)}
							>
								<span class="material-symbols-outlined" aria-hidden="true"
									>draft</span
								>
								<span>{entry.name}</span>
							</button>
						{:else}
							<div
								class="entry symlink"
								title={`/workspace/${entry.path} (symbolic link; target is not followed)`}
							>
								<span class="material-symbols-outlined" aria-hidden="true"
									>link</span
								>
								<span>{entry.name}</span>
								<small>link</small>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	{#if visible.offset > 0 || visible.remaining > 0}
		<div class="pagination">
			{#if visible.offset > 0}<button
					type="button"
					onclick={() => (offset = visible.offset - EXPLORER_PAGE_SIZE)}
					>Previous files</button
				>{/if}
			<span aria-live="polite"
				>{visible.offset + 1}–{visible.offset + visible.rows.length} of {visible.total}</span
			>
			{#if visible.remaining > 0}<button
					type="button"
					onclick={() => (offset = visible.offset + EXPLORER_PAGE_SIZE)}
					>Show more ({visible.remaining} remaining)</button
				>{/if}
		</div>
	{/if}
</div>

<style>
	.container-explorer {
		display: flex;
		flex-direction: column;
		min-height: 36px;
		overflow: hidden;
	}
	.breadcrumbs {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		padding: 4px 0;
		border-bottom: 1px solid var(--line-soft, #e5e7eb);
	}
	.breadcrumbs ol {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.breadcrumbs li {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.breadcrumbs li + li::before {
		content: '/';
		color: var(--text-4, #888);
		font-size: 10px;
	}
	button {
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-2, #535c6d);
		cursor: pointer;
		font: inherit;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
	button:hover:enabled,
	button.active {
		background: var(--primary-soft, #eaf2ff);
		color: var(--primary-strong, #2563eb);
	}
	button:focus-visible {
		outline: 2px solid var(--primary, #3182f6);
		outline-offset: -2px;
	}
	.breadcrumbs button {
		max-width: 200px;
		padding: 4px 5px;
		overflow-wrap: anywhere;
		text-align: left;
		font: 10px var(--mono, monospace);
	}
	.breadcrumbs button[aria-current] {
		color: var(--text, #1f2937);
	}
	.breadcrumbs .parent-button {
		flex: 0 0 26px;
		text-align: center;
		font-size: 15px;
	}
	.files {
		min-height: 36px;
		overflow: auto;
	}
	.files ul {
		margin: 0;
		padding: 4px 0;
		list-style: none;
	}
	.files li {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		min-width: 0;
	}
	.entry {
		display: flex;
		align-items: center;
		flex: 1 1 auto;
		gap: 6px;
		min-width: 0;
		min-height: 30px;
		padding: 5px 8px;
		text-align: left;
		font: 11px var(--mono, monospace);
		color: var(--text-2, #535c6d);
	}
	.entry > span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.entry.file,
	.entry.symlink {
		margin-left: 24px;
	}
	.toggle {
		flex: 0 0 24px;
		width: 24px;
		min-height: 30px;
		padding: 0;
		font-size: 13px;
	}
	.material-symbols-outlined {
		flex: 0 0 auto;
		font-size: 16px;
	}
	.symlink {
		color: var(--text-3, #7a8393);
	}
	.symlink span:nth-child(2) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.symlink small {
		margin-left: auto;
		font-size: 9px;
	}
	.empty {
		margin: 8px;
		color: var(--text-3, #7a8393);
		font-size: 11px;
	}
	.pagination {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
		border-top: 1px solid var(--line-soft, #e5e7eb);
		padding: 5px 0;
		color: var(--text-3, #7a8393);
		font-size: 10px;
	}
	.pagination button {
		padding: 5px;
	}
</style>
