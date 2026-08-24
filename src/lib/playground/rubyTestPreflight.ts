import {
	RUBY_PREFLIGHT_PROTOCOL,
	RUBY_PREFLIGHT_PROTOCOL_VERSION,
	RUBY_RUNTIME_PROFILE,
	type RubyRuntimePreflightPayload
} from '@wasm-idle/core';

export function createRubyRuntimeTestPreflightPayload(): RubyRuntimePreflightPayload {
	return Object.freeze({
		protocol: RUBY_PREFLIGHT_PROTOCOL,
		protocolVersion: RUBY_PREFLIGHT_PROTOCOL_VERSION,
		profileId: RUBY_RUNTIME_PROFILE.profileId,
		artifactRevision: RUBY_RUNTIME_PROFILE.artifactRevision,
		rubyVersion: RUBY_RUNTIME_PROFILE.rubyVersion,
		rubyRevision: RUBY_RUNTIME_PROFILE.rubyRevision,
		rubyWasmVersion: RUBY_RUNTIME_PROFILE.rubyWasmVersion,
		rubyWasmRevision: RUBY_RUNTIME_PROFILE.rubyWasmRevision,
		wasiSdkVersion: RUBY_RUNTIME_PROFILE.wasiSdkVersion,
		manifestFingerprint: RUBY_RUNTIME_PROFILE.manifestFingerprint,
		manifestBytes: Uint8Array.of(1),
		moduleJavaScriptBytes: Uint8Array.of(2),
		wasmBytes: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
	});
}
