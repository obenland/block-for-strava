import './style.scss';
import { registerBlockType } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { chartBar as activityIcon } from '@wordpress/icons';

import Edit from './edit';
import metadata from './block.json';

/* Dynamic block — PHP renders the frontend output. */
const save = (): null => null;

registerBlockType(metadata.name, {
	...metadata,
	title: __('Strava Activity', 'block-for-strava'),
	description: __(
		'Embed a public Strava activity on your site.',
		'block-for-strava'
	),
	icon: activityIcon,
	edit: Edit,
	save,
});
