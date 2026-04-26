import './style.scss';
import { registerBlockType } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import { chartBar as activityIcon } from '@wordpress/icons';

import Edit from './edit';
import Save from './save';
import metadata from './block.json';

registerBlockType(metadata.name, {
	...metadata,
	title: __('Strava Activity', 'block-for-strava'),
	description: __(
		'Embed a public Strava activity on your site.',
		'block-for-strava'
	),
	icon: activityIcon,
	edit: Edit,
	save: Save,
});
