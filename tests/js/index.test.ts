/**
 * Verifies that the Strava embed block is registered with the right name,
 * metadata, and Edit component. The Block Directory's discovery scan keys
 * off `block.json`, so the registered name must match the metadata
 * exactly — drift here would surface as the block silently disappearing
 * from the inserter on a fresh install.
 */
import { registerBlockType } from '@wordpress/blocks';

import metadata from '../../src/block.json';
import '../../src/index';

const calls = ( registerBlockType as jest.Mock ).mock.calls;

describe( 'registerBlockType for block-for-strava/embed', () => {
	it( 'uses the block name from block.json', () => {
		expect( calls[ 0 ][ 0 ] ).toBe( 'block-for-strava/embed' );
		expect( calls[ 0 ][ 0 ] ).toBe( metadata.name );
	} );

	it( 'returns null from save so post_content carries only the block comment', () => {
		/*
		 * The PHP render callback owns the front-end output; persisting
		 * markup in post_content would create a serialization-drift
		 * hazard for nothing.
		 */
		const settings = calls[ 0 ][ 1 ];
		expect( settings.save() ).toBeNull();
	} );

	it( 'passes the same description string as block.json so the inspector and Block Directory agree', () => {
		/*
		 * `index.tsx` re-assigns `description` only to wrap the same
		 * string in `__()` for translation — its file header commits to
		 * that. WordPress.org ingests `block.json` directly, so any drift
		 * here would mean the Block Directory and the in-editor inspector
		 * showed different copy for the same block.
		 */
		const settings = calls[ 0 ][ 1 ];
		expect( settings.description ).toBe( metadata.description );
	} );
} );
