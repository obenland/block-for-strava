/**
 * Block registration entry point.
 *
 * Registers `block-for-strava/embed` as a standalone Gutenberg block. The
 * block is the canonical way to embed Strava content in this plugin —
 * pasting a URL into a paragraph and using "Transform to" routes through
 * `paragraph-transform.ts`.
 */
import { registerBlockType } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { chartBar as stravaIcon } from '@wordpress/icons';

import metadata from './block.json';
import { Edit } from './edit';
import { save } from './save';
import './paragraph-transform';

registerBlockType( metadata.name, {
	...metadata,
	icon: stravaIcon,
	title: __( 'Strava', 'block-for-strava' ),
	description: __(
		'Embed a public Strava activity, route, or segment.',
		'block-for-strava'
	),
	edit: Edit,
	save,
} );
