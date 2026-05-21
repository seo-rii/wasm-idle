export function bindNew(obj: any, ...names: string[]) {
	const result: any = {};
	for (let name of names) result[name] = (obj[name] || (() => 0)).bind(obj);
	return result;
}

export function bind(obj: any, ...names: string[]) {
	for (let name of names) obj[name] = obj[name].bind(obj);
	return obj;
}
