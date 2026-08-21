export interface BashNestedBootstrapSourceOptions {
	sdkModuleUrl: string;
	sentinelUrl: string;
	realmUrl: string;
}

function requireHierarchicalHttpUrl(value: string, label: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw new TypeError(`Bash ${label} URL is invalid`, { cause: error });
	}
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
		throw new TypeError(`Bash ${label} URL must be a credential-free hierarchical HTTP URL`);
	}
	return url;
}

export function createBashNestedBootstrapSource(options: BashNestedBootstrapSourceOptions): string {
	const realmUrl = requireHierarchicalHttpUrl(options.realmUrl, 'realm');
	const sentinelUrl = requireHierarchicalHttpUrl(options.sentinelUrl, 'sentinel');
	if (sentinelUrl.origin !== realmUrl.origin || sentinelUrl.hash) {
		throw new TypeError(
			'Bash SDK sentinel URL must be same-origin and must not contain a hash'
		);
	}

	let sdkModuleUrl: URL;
	try {
		sdkModuleUrl = new URL(options.sdkModuleUrl);
	} catch (error) {
		throw new TypeError('Bash verified SDK Blob URL is invalid', { cause: error });
	}
	if (sdkModuleUrl.protocol !== 'blob:' || sdkModuleUrl.origin !== realmUrl.origin) {
		throw new TypeError('Bash SDK module URL must be a same-origin verified Blob URL');
	}

	const sdkModuleLiteral = JSON.stringify(sdkModuleUrl.href);
	const sentinelLiteral = JSON.stringify(sentinelUrl.href);
	return `const verifiedSdkUrl = ${sdkModuleLiteral};
const sdkSentinelUrl = ${sentinelLiteral};
let threadPoolWorker;
const pendingMessages = [];
globalThis.onerror = console.error;
globalThis.onmessage = async (event) => {
  const data = event.data;
  if (data?.type === 'init') {
    if (threadPoolWorker) {
      throw new Error('Bash nested worker has already been initialized');
    }
    const { memory, module, id } = data;
    const { init, ThreadPoolWorker } = await import(verifiedSdkUrl);
    await init({ module, memory, sdkUrl: sdkSentinelUrl });
    threadPoolWorker = new ThreadPoolWorker(id);
    for (const pending of pendingMessages.splice(0, pendingMessages.length)) {
      await threadPoolWorker.handle(pending);
    }
    return;
  }
  if (threadPoolWorker) {
    await threadPoolWorker.handle(data);
  } else {
    pendingMessages.push(data);
  }
};
`;
}
