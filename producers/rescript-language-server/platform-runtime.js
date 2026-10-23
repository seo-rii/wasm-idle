// Js_of_ocaml bindings for upstream ReScript C platform primitives.
// Mirrors compiler/ext/ext_basic_hash_stubs.c; language analysis remains upstream.
//Provides: rescript_tagged_int
function rescript_tagged_int(value) {
	return value * 2 + 1;
}
//Provides: rescript_mix_tagged_int
//Requires: caml_hash_mix_int, rescript_tagged_int
function rescript_mix_tagged_int(hash, value) {
	var tagged = rescript_tagged_int(value);
	var high = Math.floor(tagged / 4294967296);
	return caml_hash_mix_int(hash, (tagged | 0) ^ high ^ (tagged < 0 ? -1 : 0));
}
//Provides: caml_bs_hash_string
//Requires: caml_hash_mix_string, caml_hash_mix_final
function caml_bs_hash_string(value) {
	return caml_hash_mix_final(caml_hash_mix_string(0, value)) & 0x3fffffff;
}
//Provides: caml_bs_hash_int
//Requires: rescript_mix_tagged_int, caml_hash_mix_final
function caml_bs_hash_int(value) {
	return caml_hash_mix_final(rescript_mix_tagged_int(0, value)) & 0x3fffffff;
}
//Provides: caml_bs_hash_string_and_int
//Requires: caml_hash_mix_string, rescript_mix_tagged_int, caml_hash_mix_final
function caml_bs_hash_string_and_int(value, integer) {
	return (
		caml_hash_mix_final(rescript_mix_tagged_int(caml_hash_mix_string(0, value), integer)) &
		0x3fffffff
	);
}
//Provides: caml_bs_hash_stamp_and_name
//Requires: rescript_tagged_int, caml_hash_mix_int, caml_hash_mix_string, caml_hash_mix_final
function caml_bs_hash_stamp_and_name(stamp, name) {
	return (
		caml_hash_mix_final(
			stamp
				? caml_hash_mix_int(0, rescript_tagged_int(stamp) | 0)
				: caml_hash_mix_string(0, name)
		) & 0x3fffffff
	);
}
//Provides: caml_string_length_based_compare
//Requires: caml_ml_string_length, caml_string_compare
function caml_string_length_based_compare(a, b) {
	var al = caml_ml_string_length(a),
		bl = caml_ml_string_length(b);
	return al === bl ? caml_string_compare(a, b) : al < bl ? -1 : 1;
}
//Provides: caml_int_array_blit
//Requires: caml_array_blit
function caml_int_array_blit(a, offset, b, target, count) {
	return caml_array_blit(a, offset, b, target, count);
}
//Provides: caml_stale_file
//Requires: resolve_fs_device
function caml_stale_file(name) {
	var root = resolve_fs_device(name, 1);
	try {
		root.device.fs.utimesSync(root.device.nm(root.rest), 0, 0);
	} catch (_) {}
	return 0;
}
//Provides: caml_unix_realpath
//Requires: resolve_fs_device, caml_raise_nodejs_error, caml_string_of_jsbytes
function caml_unix_realpath(name) {
	var root = resolve_fs_device(name, 1);
	try {
		return caml_string_of_jsbytes(root.device.fs.realpathSync(root.device.nm(root.rest)));
	} catch (error) {
		caml_raise_nodejs_error(error, 1);
	}
}
