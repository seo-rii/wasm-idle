import Ruby from '$lib/playground/ruby';

/** Runs the unchanged upstream GolfScript interpreter on the real bundled Ruby VM. */
class Golfscript extends Ruby {
	constructor() {
		super('golfscript');
	}
}

export default Golfscript;
