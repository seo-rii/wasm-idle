<script lang="ts">
    import Clang from "$lib/clang";
    import {browser} from "$app/environment";
    import {onMount} from "svelte";

    let value = `#include <bits/stdc++.h>

        using namespace std;

        int main() {
            int a;
            cin>>a;
            cout<<"hi"<<a;
    }`;

    let clang, out;

    if (browser) onMount(() => {
        clang = new Clang({
            stdout: (str) => out += str,
        });
    });

    const run = () => clang.compileLinkRun(value);
</script>

<textarea bind:value></textarea>
<button on:click={run}>run</button>
<textarea value={out}></textarea>