import { registerBlockVariation } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { chartBar as stravaIcon } from '@wordpress/icons';

import './paragraph-transform';
import './route-controls';
import './snippet-transform';

/*
 * Subdomain coverage matches the PHP host check in
 * `Block_For_Strava_Embed::parse_strava_url()` — if the JS is stricter
 * than the server, pasted URLs would silently dead-end while the server
 * would happily render them. The `(?=[/?#]|$)` after the digits keeps
 * `/activities/123abc` from matching as activity 123, mirroring the
 * boundary the PHP handler requires.
 */
const STRAVA_PATTERNS: ReadonlyArray< RegExp > = [
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/(?:activities|routes|segments)\/\d+(?=[/?#]|$)/i,
	/^https?:\/\/strava\.app\.link\/[^\s]+/i,
];

/*
 * Treating Strava as a `core/embed` variation lets core handle URL paste,
 * the preview iframe, error UI, and the "convert to other variation"
 * affordance for free; the actual oEmbed payload is produced server-side
 * via the PHP `pre_oembed_result` filter so the variation does not need a
 * custom edit. `isActive` matches on `providerNameSlug` so saved blocks
 * round-trip back to this variation after page reload — and so we don't
 * false-positive on strava.com URLs that happen to live in a generic
 * embed block.
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
	isActive: [ 'providerNameSlug' ],
} );
