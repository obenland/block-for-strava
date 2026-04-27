import Save from '../../src/save';

describe('Save', () => {
	it('returns null because the block is server-rendered', () => {
		expect(Save()).toBeNull();
	});
});
