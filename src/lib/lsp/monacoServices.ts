import { MonacoServices } from '@hancomac/monaco-languageclient';
import type * as Monaco from 'monaco-editor';

let servicesInstalled = false;

export function installMonacoLanguageServices(MonacoModule: typeof Monaco) {
	if (servicesInstalled) return;
	MonacoServices.install(MonacoModule);
	servicesInstalled = true;
}
