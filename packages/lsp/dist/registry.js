import { getAssemblyScriptLanguageServer } from './assemblyscript/server.js';
import { getCppLanguageServer } from './clangd/server.js';
import { getCSharpLanguageServer, getVisualBasicLanguageServer } from './dotnet/server.js';
import { getPythonLanguageServer } from './python/server.js';
import { getJavaScriptLanguageServer, getTypeScriptLanguageServer } from './typescript/server.js';
import { getWatLanguageServer } from './wat/server.js';
export async function getEditorLanguageServer(language, options) {
    const normalized = language.toLowerCase();
    if (normalized === 'c' || normalized === 'cpp') {
        return getCppLanguageServer(options);
    }
    if (normalized === 'python') {
        return getPythonLanguageServer(options);
    }
    if (normalized === 'typescript' || normalized === 'ts') {
        return getTypeScriptLanguageServer(options);
    }
    if (normalized === 'javascript' || normalized === 'js') {
        return getJavaScriptLanguageServer(options);
    }
    if (normalized === 'wat' || normalized === 'webassembly') {
        return getWatLanguageServer(options);
    }
    if (normalized === 'csharp' || normalized === 'c#' || normalized === 'cs') {
        return getCSharpLanguageServer(options);
    }
    if (normalized === 'vb' ||
        normalized === 'vbnet' ||
        normalized === 'visualbasic' ||
        normalized === 'visual-basic') {
        return getVisualBasicLanguageServer(options);
    }
    if (normalized === 'assemblyscript' || normalized === 'as') {
        return getAssemblyScriptLanguageServer(options);
    }
    return null;
}
//# sourceMappingURL=registry.js.map