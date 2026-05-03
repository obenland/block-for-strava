/**
 * Shared Strava URL patterns + parsing.
 *
 * Multiple paths must agree on what counts as a Strava URL:
 * `paragraph-transform` (replaces a paragraph), `embed-transform`
 * (replaces a `core/embed` block in place), and the editor's short-URL
 * notice. Any drift would let one path fire on input the others
 * reject, producing inconsistent results for the same URL.
 */

/*
 * Anchored full-string matchers used to gate destructive transforms.
 * Optional subdomains match the PHP `is_allowed_strava_url` rule
 * (`str_ends_with($host, '.' . $allowed)`).
 */
export const CANONICAL_STRAVA_URL_PATTERN: RegExp =
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/(?:activities|routes|segments)\/\d+(?:[/?#][^\s]*)?$/i;
export const SHORT_STRAVA_URL_PATTERN: RegExp =
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.app\.link\/[^\s]+$/i;

/*
 * Parsing variant used by the editor preview to extract `(type, id)`
 * from a canonical URL. Same host/path rules as
 * `CANONICAL_STRAVA_URL_PATTERN` but with capture groups and a
 * lookahead boundary so a hand-written `/routes/123abc` doesn't
 * match as route 123.
 */
export const CANONICAL_STRAVA_URL_PARSE: RegExp =
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/(activities|routes|segments)\/(\d+)(?=[/?#]|$)/i;

export const URL_PATH_TO_TYPE: Record<
	string,
	'activity' | 'route' | 'segment'
> = {
	activities: 'activity',
	routes: 'route',
	segments: 'segment',
};

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
