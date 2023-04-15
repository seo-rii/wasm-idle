<script lang="ts">
    import type monaco from 'monaco-editor';
    import {onMount} from 'svelte';
    import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

    export const value = () => editor.getValue();

    let divEl: HTMLDivElement | null = null;
    let editor: monaco.editor.IStandaloneCodeEditor;
    let Monaco;

    onMount(async () => {
        // @ts-ignore
        self.MonacoEnvironment = {
            getWorker: function (_moduleId: any, label: string) {
                return new editorWorker();
            }
        };

        Monaco = await import('monaco-editor');
        editor = Monaco.editor.create(divEl, {
            value: `#include <bits/stdc++.h>

using namespace std;

int main() {
    int a;
    cin>>a;
    cout<<"hi"<<a;
}`,
            language: 'cpp'
        });

        return () => {
            editor.dispose();
        };
    });
</script>

<main>
    <div bind:this={divEl} class="h-screen"></div>
</main>

<style>
    main {
        flex: 1;
    }

    div {
        height: 100%;
    }
</style>