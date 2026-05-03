/**
 * Shared anchored Strava URL patterns.
 *
 * Two transform paths gate themselves on "the whole string is a Strava
 * URL" — `paragraph-transform` (replaces a paragraph entirely) and
 * `embed-transform` (replaces a `core/embed` block in place). Both paths
 * are destructive, so any drift in the recognition rules between them
 * would let one path fire on input the other rejects, producing
 * inconsistent results for the same URL. The editor's short-URL notice
 * (in `edit.tsx`) also reuses the short-URL pattern so its "is this a
 * Strava short URL?" check stays in lockstep with the transforms —
 * otherwise a value that merely starts with `strava.app.link/...` could
 * pass the editor's check while the transforms reject it.
 */
export const CANONICAL_STRAVA_URL_PATTERN: RegExp =
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/(?:activities|routes|segments)\/\d+(?:[/?#][^\s]*)?$/i;
export const SHORT_STRAVA_URL_PATTERN: RegExp =
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.app\.link\/[^\s]+$/i;

export const STRAVA_URL_PATTERNS: ReadonlyArray< RegExp > = [
	CANONICAL_STRAVA_URL_PATTERN,
	SHORT_STRAVA_URL_PATTERN,
];

/**
 * Returns true if `value` is a string matching any supported Strava URL
 * form. Narrows the type to `string` so callers can dereference the
 * result without an extra `typeof` guard.
 *
 * @param value Candidate URL.
 */
export function isStravaUrl( value: unknown ): value is string {
	if ( typeof value !== 'string' ) {
		return false;
	}
	return STRAVA_URL_PATTERNS.some( ( re ) => re.test( value ) );
}
