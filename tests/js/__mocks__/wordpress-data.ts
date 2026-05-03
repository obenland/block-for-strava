/**
 * Jest mock for `@wordpress/data`.
 *
 * `embed-transform.ts` calls `subscribe`, `select`, and `dispatch` to
 * watch the editor block list and auto-replace `core/embed` blocks
 * whose URL is a Strava URL. Tests need to:
 *
 * - capture the subscribe callback so they can fire it on demand,
 * - drive what `select('core/block-editor').getBlocks()` returns,
 * - assert against the `dispatch('core/block-editor').replaceBlock`
 *   calls the subscriber makes.
 *
 * The exposed `__mockState` lets a test set selectors/actions and grab
 * the latest captured subscriber. Reset between tests in `beforeEach`.
 */

type Subscriber = () => void;

interface SubscriberRegistration {
	cb: Subscriber;
	store?: string;
}

interface StoreSelectors {
	[ key: string ]: ( ...args: unknown[] ) => unknown;
}

interface StoreActions {
	[ key: string ]: jest.Mock;
}

interface MockState {
	/*
	 * Bare-callback view derived from `subscriberRegistrations` so the
	 * two cannot drift. Existing tests that read `__mockState.subscribers`
	 * to fire callbacks directly keep working; new tests that need to
	 * differentiate by store should use `subscriberRegistrations`.
	 */
	readonly subscribers: Subscriber[];
	subscriberRegistrations: SubscriberRegistration[];
	selectors: Record< string, StoreSelectors | undefined >;
	actions: Record< string, StoreActions | undefined >;
}

export const __mockState: MockState = {
	get subscribers(): Subscriber[] {
		return __mockState.subscriberRegistrations.map( ( reg ) => reg.cb );
	},
	subscriberRegistrations: [],
	selectors: {},
	actions: {},
};

/**
 * Clears mocked selectors and actions. Subscribers are intentionally
 * preserved — modules under test register them once at evaluation time
 * (e.g. `embed-transform.ts`), and clearing them would orphan the
 * production callback for the rest of the suite. Tests that need a
 * different subscriber set should isolate the module load explicitly.
 */
export function __resetMockState(): void {
	__mockState.selectors = {};
	__mockState.actions = {};
}

export const subscribe = jest.fn( ( cb: Subscriber, store?: string ) => {
	__mockState.subscriberRegistrations.push( { cb, store } );
	return () => {
		const regIdx = __mockState.subscriberRegistrations.findIndex(
			( reg ) => reg.cb === cb
		);
		if ( regIdx >= 0 ) {
			__mockState.subscriberRegistrations.splice( regIdx, 1 );
		}
	};
} );

export const select = jest.fn(
	( store: string ): StoreSelectors | null =>
		__mockState.selectors[ store ] ?? null
);

export const dispatch = jest.fn(
	( store: string ): StoreActions | null =>
		__mockState.actions[ store ] ?? null
);
