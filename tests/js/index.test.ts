/**
 * Verifies that the Strava embed block is registered with the right name,
 * metadata, and edit/save callbacks. The Block Directory's discovery scan
 * keys off `block.json`, so the registered name must match the metadata
 * exactly — drift here would surface as the block silently disappearing
 * from the inserter on a fresh install.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from '../../src/block.json';
import '../../src/index';

const calls = ( registerBlockType as jest.Mock ).mock.calls;

describe( 'registerBlockType for block-for-strava/embed', () => {
	it( 'registers exactly one block', () => {
		expect( calls ).toHaveLength( 1 );
	} );

	it( 'uses the block name from block.json', () => {
		expect( calls[ 0 ][ 0 ] ).toBe( 'block-for-strava/embed' );
		expect( calls[ 0 ][ 0 ] ).toBe( metadata.name );
	} );

	it( 'wires up edit and save', () => {
		const settings = calls[ 0 ][ 1 ];
		expect( typeof settings.edit ).toBe( 'function' );
		expect( typeof settings.save ).toBe( 'function' );
	} );

	it( 'preserves the embed category for inserter placement', () => {
		expect( calls[ 0 ][ 1 ].category ).toBe( 'embed' );
	} );
} );
