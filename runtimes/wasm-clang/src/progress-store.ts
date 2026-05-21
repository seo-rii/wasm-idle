export interface Readable<T> {
	subscribe(run: (value: T) => void): () => void;
}

export interface Writable<T> extends Readable<T> {
	set(value: T): void;
}

export function writable<T>(initialValue: T): Writable<T> {
	let currentValue = initialValue;
	const subscribers = new Set<(value: T) => void>();

	return {
		set(value: T) {
			currentValue = value;
			for (const subscriber of subscribers) {
				subscriber(currentValue);
			}
		},
		subscribe(run: (value: T) => void) {
			run(currentValue);
			subscribers.add(run);
			return () => {
				subscribers.delete(run);
			};
		}
	};
}

type ReadableValue<T> = T extends Readable<infer Value> ? Value : never;

export function derived<const Stores extends readonly Readable<unknown>[], Result>(
	stores: Stores,
	map: (values: { [Index in keyof Stores]: ReadableValue<Stores[Index]> }) => Result
): Readable<Result> {
	const values = stores.map(() => undefined) as unknown as {
		[Index in keyof Stores]: ReadableValue<Stores[Index]>;
	};
	const result = writable<Result>(map(values));
	let initialized = 0;

	stores.forEach((store, index) => {
		store.subscribe((value) => {
			(values as unknown as ReadableValue<Stores[typeof index]>[])[index] =
				value as ReadableValue<Stores[typeof index]>;
			if (initialized < stores.length) {
				initialized += 1;
			}
			if (initialized === stores.length) {
				result.set(map(values));
			}
		});
	});

	return {
		subscribe: result.subscribe
	};
}
