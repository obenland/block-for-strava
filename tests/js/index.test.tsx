import { registerBlockType } from '@wordpress/blocks';
import metadata from '../../src/block.json';
import Edit from '../../src/edit';

describe('block registration', () => {
	beforeEach(() => {
		(registerBlockType as jest.Mock).mockClear();
	});

	it('registers the block with metadata, translated strings, an icon, edit, and a noop save', () => {
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
		});
		/* Index.tsx overrides the JSON icon with the activity SVG icon. */
		expect(settings.icon).toBeDefined();
		expect(settings.icon).not.toBe(metadata.icon);
		/* save is a dynamic-block noop returning null. */
		expect(typeof settings.save).toBe('function');
		expect(settings.save()).toBeNull();
	});
});
