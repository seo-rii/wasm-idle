export interface JavaLanguageServerAsset {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
}

/** Original javacs 0.2.38 + OpenJDK 17 compiler; see the source/build receipts. */
export const JAVA_LANGUAGE_SERVER_ASSETS: readonly JavaLanguageServerAsset[] = Object.freeze(
	[
		{
			path: 'browser-streams.jar',
			bytes: 5360,
			sha256: '73adb53e6322df0520e52f28719377b90a8459aeaf5d8c89f975b267388cf084'
		},
		{
			path: 'server/java-language-server.jar',
			bytes: 911084,
			sha256: 'dc6113d8ae6a3c38872348d30016800dc79cc8a9fb593abf0e9f75b8f5f4fdbd'
		},
		{
			path: 'server/gson-2.8.5.jar',
			bytes: 241622,
			sha256: '233a0149fc365c9f6edbd683cfe266b19bdc773be98eabdaf6b3c924b48e7d81'
		},
		{
			path: 'server/protobuf-java-3.9.1.jar',
			bytes: 1635825,
			sha256: '5a1e5c225791eccd3d67a598922e637406190c90155fb97f38e4eab29719324d'
		},
		{
			path: 'server/jdk-compiler.jar',
			bytes: 3409258,
			sha256: '72f8095f2759a2c14f15279dcc75c2a17e853ca2205f9cabb7688f19fd8f8f39'
		}
	].map((asset) => Object.freeze(asset))
);

export const JAVA_LANGUAGE_SERVER_PROFILE = 'javacs-0.2.38-7fffb6c-openjdk17.0.20.1';
export const JAVA_CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js';
