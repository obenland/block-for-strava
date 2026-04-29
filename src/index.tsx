import { registerBlockVariation } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { chartBar as stravaIcon } from '@wordpress/icons';

import './paragraph-transform';

/*
 * Match canonical Strava activity, route, and segment URLs plus
 * strava.app.link short links. Patterns are evaluated by core/embed when a
 * URL is pasted; the first matching variation wins, so our patterns stay
 * tight enough that non-Strava strava.com URLs (e.g. /clubs/, /athletes/)
 * fall through to other handlers.
 *
 * Subdomain coverage matches the PHP host check in
 * `block_for_strava_parse_strava_url()` — if the JS is stricter than the
 * server it's a silent dead-end (URL pastes through unrecognized while the
 * server would happily render it).
 */
const STRAVA_PATTERNS: ReadonlyArray< RegExp > = [
	// `(?=[/?#]|$)` after the digits keeps `/activities/123abc` from
	// matching as activity 123, mirroring the boundary the PHP handler
	// requires.
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/(?:activities|routes|segments)\/\d+(?=[/?#]|$)/i,
	/^https?:\/\/strava\.app\.link\/[^\s]+/i,
];

/**
 * Registers a `core/embed` block variation that captures Strava URLs.
 *
 * Treating Strava as an embed variation lets core handle URL paste, the
 * preview iframe, error UI, and the "convert to other variation" affordance
 * for free; the actual oEmbed payload is produced server-side via the PHP
 * `pre_oembed_result` filter so the variation does not need a custom edit.
 */
registerBlockVariation( 'core/embed', {
	name: 'strava',
	title: __( 'Strava', 'block-for-strava' ),
	icon: stravaIcon,
	keywords: [
		__( 'strava', 'block-for-strava' ),
		__( 'activity', 'block-for-strava' ),
		__( 'route', 'block-for-strava' ),
		__( 'segment', 'block-for-strava' ),
		__( 'fitness', 'block-for-strava' ),
		__( 'running', 'block-for-strava' ),
		__( 'cycling', 'block-for-strava' ),
	],
	description: __(
		'Embed a Strava activity, route, or segment.',
		'block-for-strava'
	),
	patterns: STRAVA_PATTERNS,
	attributes: {
		providerNameSlug: 'strava',
		responsive: true,
	},
	/*
	 * isActive is what makes a saved block round-trip back to our variation
	 * after page reload. Match on the providerNameSlug (set when paste hits
	 * one of our patterns above) so we don't false-positive on strava.com
	 * URLs that happen to live in a generic embed block.
	 */
	isActive: [ 'providerNameSlug' ],
} );
