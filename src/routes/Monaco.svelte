<script lang="ts">
    import type monaco from 'monaco-editor';
    import {onMount} from 'svelte';
    import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

    export const value = () => editor.getValue();

    const defaults = {
        cpp: `#include <bits/stdc++.h>

using namespace std;

int main() {
    int a;
    cout << "Enter a number: ";
    cin >> a;
    for(int i = 0; i < a; i++) cout << i << endl;
}`, python: `a = int(input("Enter a number: "))
for i in range(a):
    print(i)`
    };

    let divEl: HTMLDivElement | null = null;
    export let editor: monaco.editor.IStandaloneCodeEditor, language;
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
            value: defaults[language],
            language
        });

        return () => editor.dispose();
    });
</script>

<main>
    <div bind:this={divEl} class="h-screen"></div>
</main>

<style>
    main {
        flex: 1;
        border-left: 1px solid #e5e7eb;
    }

    div {
        height: 100%;
    }
</style>