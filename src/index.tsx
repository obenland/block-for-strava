/**
 * Block registration entry point.
 *
 * Registers `block-for-strava/embed` as a dynamic Gutenberg block — the
 * `save` callback returns `null` because the PHP `render_callback` (wired
 * through `block.json`) generates the front-end iframe from attributes.
 * Pasting a URL into a paragraph and using "Transform to" routes through
 * `paragraph-transform.ts`.
 *
 * The icon flows from `block.json` via spread so the editor and the Block
 * Directory listing read from a single source of truth — Block Directory
 * cannot resolve a JS-imported `@wordpress/icons` reference, only static
 * `block.json` fields. `title` and `description` are re-assigned below to
 * wrap the same strings in `__()` for translation.
 */
import { registerBlockType } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';

import metadata from './block.json';
import { Edit } from './edit';
import './paragraph-transform';
import './snippet-transform';

registerBlockType( metadata.name, {
	...metadata,
	title: __( 'Strava', 'block-for-strava' ),
	description: __(
		'Embed a public Strava activity, route, or segment.',
		'block-for-strava'
	),
	edit: Edit,
	save: () => null,
} );
