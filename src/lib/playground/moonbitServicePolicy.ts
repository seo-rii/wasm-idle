import { RuntimeConfigurationError } from '@wasm-idle/core';

/** Technical containment pending a separate review of the compiler's service terms. */
export const MOONBIT_SERVICE_POLICY = Object.freeze({
	available: false,
	message:
		'MoonBit execution is unavailable pending review of the compiler’s service-license terms (MPSL §14).'
} as const);

export interface MoonbitResearchOptions {
	/** Local compiler research only; this does not grant license permission or permit publication. */
	localResearchOnly?: boolean;
}

export function assertMoonbitLocalResearch(
	options: MoonbitResearchOptions,
	currentUrl = globalThis.location?.href ?? ''
) {
	let loopback = false;
	try {
		const url = new URL(currentUrl);
		loopback =
			['http:', 'https:'].includes(url.protocol) &&
			['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	} catch {
		// Missing/non-browser origins do not enable experimental execution.
	}
	if (options.localResearchOnly !== true || !loopback)
		throw new RuntimeConfigurationError(
			MOONBIT_SERVICE_POLICY.message +
				' See docs/moonbit.md. Explicit local research is restricted to loopback origins and cannot enable publication.',
			{ runtimeId: 'MOONBIT' }
		);
}
