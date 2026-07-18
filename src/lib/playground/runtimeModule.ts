export async function importRuntimeModule<T>(moduleUrl: string): Promise<T> {
	if (!moduleUrl) throw new Error('Runtime module URL is not configured.');
	return (await import(/* @vite-ignore */ moduleUrl)) as T;
}
