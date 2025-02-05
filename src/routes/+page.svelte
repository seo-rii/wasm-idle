<script lang="ts">
	import Monaco from './Monaco.svelte';
	import Terminal from '$lib';
	import { page } from '$app/state';
	import { browser } from '$app/environment';

	let path = $derived(
		page.url.pathname.endsWith('/') ? page.url.pathname.slice(0, -1) : page.url.pathname
	);

	let editor = $state(),
		terminal = $state(),
		log = $state(true),
		language = $state('CPP'),
		init = $state(false);

	async function exec() {
		if (browser) {
			localStorage.setItem('code', editor.getValue());
			localStorage.setItem('language', language);
		}
		if (!('SharedArrayBuffer' in window)) location.reload();
		await terminal.clear();
		let r;
		console.log(
			(r = await terminal.prepare(language, editor.getValue(), log, { set: console.log }))
		);
		if (r) console.log(await terminal.run(language, editor.getValue(), log));
	}

	$effect(() => {
		if (browser && editor && !init) {
			const code = localStorage.getItem('code');
			const lang = localStorage.getItem('language');
			if (code) editor.setValue(code);
			if (lang) language = lang;
			init = true;
		}
	});
</script>

<main>
	<div style="width: 50%">
		{path}
		<button onclick={exec}>Run</button>
		<input type="checkbox" bind:checked={log} />
		<label>Log</label>
		<select bind:value={language}>
			<option value="CPP">C++</option>
			<option value="PYTHON">Python</option>
		</select>
		<Terminal bind:terminal {path} />
	</div>
	{#key language}
		<Monaco language={language.toLowerCase()} bind:editor />
	{/key}
</main>

<style>
	main {
		height: calc(100vh - 40px);
		display: flex;
		flex-direction: row;
	}
</style>
