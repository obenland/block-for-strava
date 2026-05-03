/**
 * Covers the toolbar `from`-block transform and the `subscribe()`
 * auto-replace watcher for `core/embed` → `block-for-strava/embed`.
 */
import { applyFilters } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

import { __mockState, __resetMockState } from './__mocks__/wordpress-data';
import { subscribe } from '@wordpress/data';
import { __resetForTests } from '../../src/embed-transform';

interface BlockTransform {
	type: 'block';
	blocks: ReadonlyArray< string >;
	isMatch: ( attrs: Record< string, unknown > ) => boolean;
	transform: ( attrs: Record< string, unknown > ) => unknown;
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
	attributes: Record< string, unknown >;
	innerBlocks?: FakeBlock[];
}

interface EditorActions {
	replaceBlock: jest.Mock;
	__unstableMarkNextChangeAsNotPersistent: jest.Mock;
	[ key: string ]: jest.Mock;
}

function setEditorBlocks(
	blocks: FakeBlock[],
	options: { isDirty?: boolean; postId?: number } = {}
): EditorActions {
	const actions: EditorActions = {
		replaceBlock: jest.fn(),
		__unstableMarkNextChangeAsNotPersistent: jest.fn(),
	};
	const postId = options.postId ?? 1;
	__mockState.selectors[ 'core/block-editor' ] = {
		getBlocks: () => blocks,
	};
	__mockState.selectors[ 'core/editor' ] = {
		isEditedPostDirty: () => true === options.isDirty,
		getCurrentPostId: () => postId,
	};
	__mockState.actions[ 'core/block-editor' ] = actions;
	return actions;
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

	function getEmbedTransform(): BlockTransform {
		const result = runFilter( {}, 'block-for-strava/embed' );
		const from = ( result.transforms?.from ?? [] ) as BlockTransform[];
		const transform = from.find(
			( t ) => 'block' === t.type && t.blocks?.[ 0 ] === 'core/embed'
		);
		if ( ! transform ) {
			throw new Error( 'embed block transform missing' );
		}
		return transform;
	}

	it( 'creates a block-for-strava/embed with the URL preserved', () => {
		getEmbedTransform().transform( {
			url: 'https://www.strava.com/activities/18233733854',
		} );
		expect( createBlock ).toHaveBeenCalledWith( 'block-for-strava/embed', {
			url: 'https://www.strava.com/activities/18233733854',
		} );
	} );

	it( 'preserves align/className/anchor/caption wrapper attributes through the conversion', () => {
		/*
		 * Without explicit passthrough, `createBlock` drops everything
		 * but `url`, silently losing alignment/class/anchor/caption.
		 */
		getEmbedTransform().transform( {
			url: 'https://www.strava.com/activities/18233733854',
			align: 'wide',
			className: 'is-style-rounded',
			anchor: 'my-ride',
			caption: 'My morning ride',
			allowResponsive: true,
			previewable: true,
		} );
		expect( createBlock ).toHaveBeenCalledWith( 'block-for-strava/embed', {
			url: 'https://www.strava.com/activities/18233733854',
			align: 'wide',
			className: 'is-style-rounded',
			anchor: 'my-ride',
			caption: 'My morning ride',
		} );
	} );

	it( 'omits wrapper attributes the source block did not set', () => {
		// `undefined` source attrs must not land in the result object.
		getEmbedTransform().transform( {
			url: 'https://www.strava.com/activities/18233733854',
			align: undefined,
		} );
		expect( createBlock ).toHaveBeenCalledWith( 'block-for-strava/embed', {
			url: 'https://www.strava.com/activities/18233733854',
		} );
	} );
} );

describe( 'auto-replace subscriber registration', () => {
	it( 'subscribes to the core/block-editor store, not the global tick stream', () => {
		/*
		 * Without the store-name arg the watcher would walk on every
		 * data store's tick, not just block-editor changes.
		 */
		expect( subscribe ).toHaveBeenCalledWith(
			expect.any( Function ),
			'core/block-editor'
		);
	} );
} );

describe( 'auto-replace subscriber: first walk treats existing blocks as legacy', () => {
	beforeEach( () => {
		/* `__resetForTests` lets each test independently exercise `initialized === false`. */
		__mockState.selectors = {};
		__mockState.actions = {};
		__resetForTests();
		( createBlock as jest.Mock ).mockClear();
	} );

	it( 'does not convert legacy core/embed Strava blocks present at editor load', () => {
		/*
		 * Numeric id matters — a malformed URL would be rejected by
		 * `isStravaUrl` first and the test would pass for the wrong
		 * reason.
		 */
		const cid = uniqueClientId( 'legacy' );
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/12345',
				},
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).not.toHaveBeenCalled();
	} );

	it( 'still does not convert legacy clientIds on subsequent ticks', () => {
		const cid = uniqueClientId( 'legacy' );
		setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/12345',
				},
			},
		] );
		fireSubscribers();
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/12345',
				},
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).not.toHaveBeenCalled();
	} );

	it( 'converts a core/embed if the first non-empty walk happens while the editor is already dirty (user paste before content load)', () => {
		// Without the dirty gate, a user paste landing on the first
		// non-empty walk would be recorded as legacy and never
		// converted.
		const cid = uniqueClientId( 'first-paste' );
		const { replaceBlock } = setEditorBlocks(
			[
				{
					clientId: cid,
					name: 'core/embed',
					attributes: {
						url: 'https://www.strava.com/activities/12345',
					},
				},
			],
			{ isDirty: true }
		);
		fireSubscribers();
		expect( replaceBlock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'auto-converts a legacy Strava core/embed if its URL is later edited to a different Strava URL', () => {
		/*
		 * Marking legacy blocks by clientId alone would freeze them
		 * out of conversion forever. Pair the legacy mark with the
		 * URL so a user actively editing the URL invalidates the
		 * skip and the watcher converts the now-modified block.
		 */
		const cid = uniqueClientId( 'edited-legacy' );
		setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/111',
				},
			},
		] );
		fireSubscribers();
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/222',
				},
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'auto-converts a non-Strava core/embed if its URL later changes to a Strava URL', () => {
		/*
		 * Loaded `core/embed` blocks that aren't currently Strava
		 * shouldn't be marked as legacy — otherwise editing one's
		 * URL to a Strava form afterward would never trigger a
		 * conversion (same clientId stays in the skip set).
		 */
		const cid = uniqueClientId( 'changing' );
		setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				},
			},
		] );
		fireSubscribers();
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/12345',
				},
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'records the first non-empty walk as legacy when core/editor is not registered (non-post-editor context)', () => {
		// Site editor / widgets editor don't register `core/editor`.
		// Falling back to "treat as legacy" mirrors the post-editor
		// default, which is the safer choice for those contexts.
		const cid = uniqueClientId( 'no-editor' );
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/12345',
				},
			},
		] );
		__mockState.selectors[ 'core/editor' ] = undefined;
		fireSubscribers();
		expect( replaceBlock ).not.toHaveBeenCalled();
	} );

	it( 'resets legacy markers when the post entity changes (SPA navigation)', () => {
		/*
		 * Site editor / custom post-editor adapters swap the edited
		 * entity without reloading the page. Detected via the entity
		 * ID changing between two non-null values; legacy markers from
		 * the prior document are cleared so the new document's blocks
		 * get a fresh first walk.
		 */
		setEditorBlocks(
			[
				{
					clientId: uniqueClientId( 'docA' ),
					name: 'core/embed',
					attributes: {
						url: 'https://www.strava.com/activities/111',
					},
				},
			],
			{ postId: 1 }
		);
		fireSubscribers();
		const { replaceBlock } = setEditorBlocks(
			[
				{
					clientId: uniqueClientId( 'docB' ),
					name: 'core/embed',
					attributes: {
						url: 'https://www.strava.com/activities/222',
					},
				},
			],
			{ postId: 2 }
		);
		fireSubscribers();
		// docB's Strava embed should be treated as legacy (a freshly
		// loaded document), not auto-converted.
		expect( replaceBlock ).not.toHaveBeenCalled();
	} );

	it( 'defers initialization across an empty boot snapshot until the saved content arrives', () => {
		/*
		 * Editor boot may emit `[]` before `INIT_EDITOR` loads the
		 * post; if `initialized` flipped on that empty snapshot, the
		 * saved content arriving next would auto-convert as if pasted.
		 */
		setEditorBlocks( [] );
		fireSubscribers();
		const cid = uniqueClientId( 'late-loaded' );
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/12345',
				},
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).not.toHaveBeenCalled();
	} );
} );

describe( 'auto-replace subscriber', () => {
	beforeEach( () => {
		/*
		 * Warm up with a non-empty walk so `initialized` flips. Each
		 * test then exercises the post-init regime against fresh
		 * clientIds.
		 */
		__mockState.selectors = {};
		__mockState.actions = {};
		__resetForTests();
		( createBlock as jest.Mock ).mockClear();
		setEditorBlocks( [
			{
				clientId: '__warmup__',
				name: 'core/paragraph',
				attributes: {},
			},
		] );
		fireSubscribers();
		( createBlock as jest.Mock ).mockClear();
	} );

	it( 'replaces a core/embed block carrying a Strava URL with block-for-strava/embed', () => {
		const cid = uniqueClientId( 'activity' );
		const { replaceBlock } = setEditorBlocks( [
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

	it( 'marks the auto-replace as non-persistent so undo collapses paste+convert into one entry', () => {
		// Pin invocation order: marker fires BEFORE replaceBlock.
		const cid = uniqueClientId( 'undo' );
		const actions = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/18233733854',
				},
			},
		] );
		fireSubscribers();
		expect(
			actions.__unstableMarkNextChangeAsNotPersistent
		).toHaveBeenCalledTimes( 1 );
		expect(
			actions.__unstableMarkNextChangeAsNotPersistent.mock
				.invocationCallOrder[ 0 ]
		).toBeLessThan( actions.replaceBlock.mock.invocationCallOrder[ 0 ] );
	} );

	it( 'preserves align/className/anchor/caption wrapper attributes when auto-replacing', () => {
		const cid = uniqueClientId( 'wrapper' );
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/18233733854',
					align: 'full',
					className: 'is-style-rounded',
					anchor: 'my-ride',
					caption: 'My morning ride',
				},
			},
		] );
		fireSubscribers();
		expect( createBlock ).toHaveBeenCalledWith( 'block-for-strava/embed', {
			url: 'https://www.strava.com/activities/18233733854',
			align: 'full',
			className: 'is-style-rounded',
			anchor: 'my-ride',
			caption: 'My morning ride',
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
		const { replaceBlock } = setEditorBlocks( [
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
		const { replaceBlock } = setEditorBlocks( [
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
		const { replaceBlock } = setEditorBlocks( [
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
		const { replaceBlock } = setEditorBlocks( blocks );
		fireSubscribers();
		/*
		 * Fresh array each tick to defeat the lastBlocks reference cache
		 * — pins that dedupe holds even when the cache short-circuit can't.
		 */
		__mockState.selectors[ 'core/block-editor' ] = {
			getBlocks: () => [ ...blocks ],
		};
		fireSubscribers();
		fireSubscribers();
		expect( replaceBlock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'short-circuits when the block list reference is unchanged', () => {
		const { replaceBlock } = setEditorBlocks( [
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
		// Boot-race: `select` returns null until the store registers.
		__mockState.selectors[ 'core/block-editor' ] = undefined;
		expect( () => fireSubscribers() ).not.toThrow();
		expect( createBlock ).not.toHaveBeenCalled();
	} );
} );
