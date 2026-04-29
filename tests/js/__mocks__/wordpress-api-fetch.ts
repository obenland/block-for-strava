/**
 * Jest mock for `@wordpress/api-fetch`.
 *
 * The default returns a never-resolving promise so an effect that fires
 * `apiFetch().then(setState)` in a test that doesn't care about the
 * preflight result doesn't trigger a state update outside `act()` — and
 * therefore doesn't surface a console.error that the project's
 * `@wordpress/jest-console` setup turns into a test failure. Tests that
 * DO care about the response opt in via `mockResolvedValueOnce(...)`.
 */
const apiFetch = jest.fn< Promise< unknown >, [ unknown ] >(
	() => new Promise< unknown >( () => {} )
);

export default apiFetch;
