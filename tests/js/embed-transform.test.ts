/**
 * Verifies the `core/embed` → `block-for-strava/embed` conversion path.
 *
 * Two seams to pin:
 *
 * 1. The `from`-block transform registered on `block-for-strava/embed`,
 *    which surfaces "Transform to → Strava" in the toolbar of any
 *    `core/embed` block carrying a Strava URL.
 * 2. The `subscribe` watcher that auto-replaces `core/embed` blocks the
 *    moment Gutenberg's URL paste handler creates one.
 *
 * Each test uses unique clientIds because the module's internal
 * `replaced` Set persists for the test file's lifetime (the watcher is
 * registered once at module load and a reload would orphan the captured
 * callback in the mocked `@wordpress/data`).
 */
import { applyFilters } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

import { __mockState, __resetMockState } from './__mocks__/wordpress-data';
import '../../src/embed-transform';

interface BlockTransform {
	type: 'block';
	blocks: ReadonlyArray< string >;
	isMatch: ( attrs: { url?: unknown } ) => boolean;
	transform: ( attrs: { url?: unknown } ) => unknown;
}

interface BlockSettings {
	transforms?: { from?: ReadonlyArray< unknown > };
	[ key: string ]: unknown;
}

function runFilter( settings: BlockSettings, name: string ): BlockSettings {
	return applyFilters(
		'blocks.registerBlockType',
		settings,
		name
	) as BlockSettings;
}

let cidCounter = 0;
function uniqueClientId( prefix: string ): string {
	cidCounter += 1;
	return `${ prefix }-${ cidCounter }`;
}

interface FakeBlock {
	clientId: string;
	name: string;
	attributes: { url?: unknown };
	innerBlocks?: FakeBlock[];
}

function setEditorBlocks( blocks: FakeBlock[] ): jest.Mock {
	const replaceBlock = jest.fn();
	__mockState.selectors[ 'core/block-editor' ] = {
		getBlocks: () => blocks,
	};
	__mockState.actions[ 'core/block-editor' ] = { replaceBlock };
	return replaceBlock;
}

function fireSubscribers(): void {
	for ( const cb of __mockState.subscribers ) {
		cb();
	}
}

describe( 'block-for-strava/embed-block-transform filter', () => {
	beforeEach( () => {
		__resetMockState();
		( createBlock as jest.Mock ).mockClear();
	} );

	it( 'leaves non-target block settings untouched', () => {
		const settings: BlockSettings = { transforms: { from: [] } };
		const result = runFilter( settings, 'core/paragraph' );
		expect( result ).toBe( settings );
	} );

	it( 'adds a single block transform on block-for-strava/embed', () => {
		const result = runFilter( {}, 'block-for-strava/embed' );
		const from = ( result.transforms?.from ?? [] ) as BlockTransform[];
		const blockTransforms = from.filter( ( t ) => 'block' === t.type );
		expect( blockTransforms ).toHaveLength( 1 );
		expect( blockTransforms[ 0 ].blocks ).toEqual( [ 'core/embed' ] );
	} );

	it( 'preserves existing from transforms', () => {
		const existing = {
			type: 'raw' as const,
			isMatch: () => false,
			transform: () => ( {} ),
		};
		const result = runFilter(
			{ transforms: { from: [ existing ] } },
			'block-for-strava/embed'
		);
		const from = result.transforms?.from ?? [];
		expect( from ).toContain( existing );
		expect( from.length ).toBeGreaterThan( 1 );
	} );
} );

describe( 'embed block transform isMatch', () => {
	let isMatch: ( attrs: { url?: unknown } ) => boolean;

	beforeEach( () => {
		__resetMockState();
		( createBlock as jest.Mock ).mockClear();
		const result = runFilter( {}, 'block-for-strava/embed' );
		const from = ( result.transforms?.from ?? [] ) as BlockTransform[];
		const transform = from.find(
			( t ) => 'block' === t.type && t.blocks?.[ 0 ] === 'core/embed'
		);
		if ( ! transform ) {
			throw new Error( 'embed block transform missing' );
		}
		isMatch = transform.isMatch;
	} );

	it.each( [
		[ 'https://www.strava.com/activities/18233733854' ],
		[ 'https://strava.com/activities/123' ],
		[ 'https://www.strava.com/routes/3379104463896442748' ],
		[ 'https://www.strava.com/segments/789' ],
		[ 'https://app.strava.com/activities/123' ],
		[ 'https://www.strava.com/activities/123/overview?foo=1' ],
		[ 'https://strava.app.link/5nv42wErO2b' ],
	] )( 'matches Strava URL %s', ( url ) => {
		expect( isMatch( { url } ) ).toBe( true );
	} );

	it.each( [
		[ '' ],
		[ 'not a url' ],
		[ 'https://example.com/activities/123' ],
		[ 'https://www.strava.com/clubs/456' ],
		[ 'https://www.strava.com/activities/abc' ],
		[ 'mailto:foo@strava.com' ],
		[ 'http://strava.com.evil.example/activities/1' ],
	] )( 'rejects non-Strava URL %s', ( url ) => {
		expect( isMatch( { url } ) ).toBe( false );
	} );

	it( 'rejects non-string URL attribute', () => {
		expect( isMatch( { url: undefined } ) ).toBe( false );
		expect( isMatch( {} ) ).toBe( false );
	} );
} );

describe( 'embed block transform transform()', () => {
	beforeEach( () => {
		__resetMockState();
		( createBlock as jest.Mock ).mockClear();
	} );

	it( 'creates a block-for-strava/embed with the URL preserved', () => {
		const result = runFilter( {}, 'block-for-strava/embed' );
		const from = ( result.transforms?.from ?? [] ) as BlockTransform[];
		const transform = from.find(
			( t ) => 'block' === t.type && t.blocks?.[ 0 ] === 'core/embed'
		);
		transform!.transform( {
			url: 'https://www.strava.com/activities/18233733854',
		} );
		expect( createBlock ).toHaveBeenCalledWith( 'block-for-strava/embed', {
			url: 'https://www.strava.com/activities/18233733854',
		} );
	} );
} );

describe( 'auto-replace subscriber', () => {
	beforeEach( () => {
		/*
		 * Clear selectors/actions only — the production subscriber was
		 * registered at module load and lives in __mockState.subscribers
		 * for the suite's lifetime. Wiping that array would orphan it.
		 */
		__mockState.selectors = {};
		__mockState.actions = {};
		( createBlock as jest.Mock ).mockClear();
	} );

	it( 'replaces a core/embed block carrying a Strava URL with block-for-strava/embed', () => {
		const cid = uniqueClientId( 'activity' );
		const replaceBlock = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/18233733854',
				},
			},
		] );
		fireSubscribers();
		expect( createBlock ).toHaveBeenCalledWith( 'block-for-strava/embed', {
			url: 'https://www.strava.com/activities/18233733854',
		} );
		expect( replaceBlock ).toHaveBeenCalledWith(
			cid,
			expect.objectContaining( { name: 'block-for-strava/embed' } )
		);
	} );

	it.each( [
		[ 'short URL', 'https://strava.app.link/5nv42wErO2b' ],
		[ 'route URL', 'https://www.strava.com/routes/3379104463896442748' ],
		[ 'segment URL', 'https://www.strava.com/segments/789' ],
	] )( 'replaces core/embed for %s', ( _name, url ) => {
		const replaceBlock = setEditorBlocks( [
			{
				clientId: uniqueClientId( 'url' ),
				name: 'core/embed',
				attributes: { url },
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'leaves non-Strava core/embed blocks alone', () => {
		const replaceBlock = setEditorBlocks( [
			{
				clientId: uniqueClientId( 'youtube' ),
				name: 'core/embed',
				attributes: {
					url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				},
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).not.toHaveBeenCalled();
	} );

	it( 'recurses into innerBlocks (e.g., embeds inside groups/columns)', () => {
		const innerCid = uniqueClientId( 'inner' );
		const replaceBlock = setEditorBlocks( [
			{
				clientId: uniqueClientId( 'group' ),
				name: 'core/group',
				attributes: {},
				innerBlocks: [
					{
						clientId: innerCid,
						name: 'core/embed',
						attributes: {
							url: 'https://www.strava.com/activities/123',
						},
					},
				],
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).toHaveBeenCalledWith(
			innerCid,
			expect.objectContaining( { name: 'block-for-strava/embed' } )
		);
	} );

	it( 'replaces each clientId at most once across multiple subscriber ticks', () => {
		// `subscribe` fires repeatedly during a single dispatch; without
		// the `replaced` set inside the module, we'd queue several
		// `replaceBlock` calls for the same source block. Pin that the
		// dedupe holds even when the editor returns a fresh block-list
		// reference each tick (which defeats the lastBlocks short-circuit).
		const cid = uniqueClientId( 'dedupe' );
		const blocks: FakeBlock[] = [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/1',
				},
			},
		];
		const replaceBlock = setEditorBlocks( blocks );
		fireSubscribers();
		// Swap in a new array with the same content so the lastBlocks
		// reference cache doesn't suppress the second walk.
		__mockState.selectors[ 'core/block-editor' ] = {
			getBlocks: () => [ ...blocks ],
		};
		fireSubscribers();
		fireSubscribers();
		expect( replaceBlock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'short-circuits when the block list reference is unchanged', () => {
		const replaceBlock = setEditorBlocks( [
			{
				clientId: uniqueClientId( 'unchanged' ),
				name: 'core/embed',
				attributes: { url: 'https://example.com' },
			},
		] );
		fireSubscribers();
		fireSubscribers();
		expect( replaceBlock ).not.toHaveBeenCalled();
	} );

	it( 'no-ops when core/block-editor is not registered', () => {
		// `subscribe` can fire on a tick where the store hasn't booted
		// yet and `select('core/block-editor')` returns null. The
		// watcher must exit cleanly rather than crash the editor.
		__mockState.selectors[ 'core/block-editor' ] = undefined;
		expect( () => fireSubscribers() ).not.toThrow();
		expect( createBlock ).not.toHaveBeenCalled();
	} );
} );
