import { registerBlockType } from '@wordpress/blocks';
import metadata from '../../src/block.json';
import Edit from '../../src/edit';
import Save from '../../src/save';

describe('block registration', () => {
	beforeEach(() => {
		(registerBlockType as jest.Mock).mockClear();
	});

	it('registers the block with metadata, translated strings, an icon, edit, and save', () => {
		require('../../src/index');

		expect(registerBlockType).toHaveBeenCalledTimes(1);
		const [name, settings] = (registerBlockType as jest.Mock).mock.calls[0];

		expect(name).toBe(metadata.name);
		const { icon: _ignoredMetaIcon, ...restMetadata } = metadata;
		expect(settings).toMatchObject({
			...restMetadata,
			title: 'Strava Activity',
			description: 'Embed a public Strava activity on your site.',
			edit: Edit,
			save: Save,
		});
		// Index.tsx overrides the JSON icon with the activity SVG icon.
		expect(settings.icon).toBeDefined();
		expect(settings.icon).not.toBe(metadata.icon);
	});
});
