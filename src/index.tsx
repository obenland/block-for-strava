/**
 * Block registration entry point.
 *
 * Registers `block-for-strava/embed` as a dynamic Gutenberg block — the
 * `save` callback returns `null` because the PHP `render_callback` (wired
 * through `block.json`) generates the front-end iframe from attributes.
 * Pasting a URL into a paragraph and using "Transform to" routes through
 * `paragraph-transform.ts`.
 *
 * The icon is declared twice on purpose: `block.json` carries an SVG string
 * because the WordPress.org Block Directory only reads static `block.json`
 * fields, but `@wordpress/blocks` doesn't reliably render an SVG string from
 * a JS spread into a React tree — it produces a detached DOM node that the
 * inserter falls back to the default cube on. Passing `chartBar` (whose path
 * matches the SVG in `block.json` exactly) as a React element overrides the
 * spread for the editor while leaving the Block Directory source untouched.
 * `title` and `description` are re-assigned below to wrap the same strings
 * in `__()` for translation.
 */
import { registerBlockType } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { chartBar } from '@wordpress/icons';

import metadata from './block.json';
import { Edit } from './edit';
import './paragraph-transform';
import './snippet-transform';
import './embed-transform';

registerBlockType( metadata.name, {
	...metadata,
	icon: chartBar,
	title: __( 'Strava', 'block-for-strava' ),
	description: __(
		'Embed a public Strava activity, route, or segment.',
		'block-for-strava'
	),
	edit: Edit,
	save: () => null,
} );
