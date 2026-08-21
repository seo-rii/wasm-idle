export const BUNDLED_PASCAL_RUNTIME_PROFILE = {
	profileId: 'pascal-pas2js-3.2.1-legacy-2c1edc2d',
	artifactRevision: '2c1edc2d47a221498d6086f62431796012e2f3ca',
	pas2jsVersion: '3.2.1',
	pas2jsRevision: '9ac46614dc82',
	manifestFingerprint: 'fa138a92a9092c8b3f756fa05d489b690d708a746aa50d9eeab4258099ccf3de',
	manifestReceipt: {
		bytes: 3252,
		sha256: 'e810c87b04c79b522b0433988e40bb5770dfd06d3d892416b333020b9d7ac7b3'
	},
	compilerJavaScriptReceipt: {
		bytes: 495779,
		sha256: '603829fbb9b9663f243a9adb30a59a0c0d0251bae2a869dd4f2402ed7c554a2a',
		uncompressedBytes: 3332860,
		uncompressedSha256: 'b35968e4acaff893ab9e712815cf83f4d9b3ae4ca23a307b83ec37c65c4a6756'
	},
	rtlJavaScriptReceipt: {
		bytes: 49020,
		sha256: '26fb07d209ca42654ada5c13357abdd630a0693fbb5a7806d32fa089adab026c'
	},
	systemPascalReceipt: {
		bytes: 31650,
		sha256: '524c5cbd1b8c23c284943fa7c76e3cc42ac0be099072a6f0ea84418cfc08fb39'
	}
} as const;
export const BUNDLED_PASCAL_RUNTIME_BUNDLE = Object.freeze({
	profile: BUNDLED_PASCAL_RUNTIME_PROFILE,
	workerReceipt: {
		bytes: 20309,
		sha256: '1067c3d36b7cf7d56b2679b43a18105dfac7c4a6f234f68e5bce11e15dc3ff12'
	}
});
export const BUNDLED_PASCAL_MANIFEST_FINGERPRINT =
	BUNDLED_PASCAL_RUNTIME_PROFILE.manifestFingerprint;
export const BUNDLED_PASCAL_RUNNER_RECEIPT = BUNDLED_PASCAL_RUNTIME_BUNDLE.workerReceipt;
