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

function setEditorBlocks( blocks: FakeBlock[] ): EditorActions {
	const actions: EditorActions = {
		replaceBlock: jest.fn(),
		__unstableMarkNextChangeAsNotPersistent: jest.fn(),
	};
	__mockState.selectors[ 'core/block-editor' ] = {
		getBlocks: () => blocks,
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
		 * A user who has set wide alignment, a custom class, an HTML
		 * anchor, or caption text on a styled core/embed block
		 * expects those to survive when "Transform to → Strava"
		 * replaces the block. Without explicit passthrough Gutenberg's
		 * `createBlock` would drop everything outside the second-arg
		 * attributes object, and the user would lose their content
		 * silently.
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
		/*
		 * `undefined` should not land in the attribute object — if it
		 * did, Gutenberg would still record the key and a later editor
		 * session might serialize it as an explicit null.
		 */
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
		 * The watcher's walk cost would compound on every other
		 * store's state changes (notices, preferences, etc.) if the
		 * second arg to `subscribe` were ever dropped. Pin that we
		 * pass `'core/block-editor'` so a future refactor can't
		 * silently regress the scoping.
		 */
		expect( subscribe ).toHaveBeenCalledWith(
			expect.any( Function ),
			'core/block-editor'
		);
	} );
} );

describe( 'auto-replace subscriber: first walk treats existing blocks as legacy', () => {
	beforeEach( () => {
		/*
		 * Reset both the mocked data store and the production
		 * watcher's module-level state. Without `__resetForTests`,
		 * tests in this describe would only exercise the "first walk"
		 * branch if they ran before any other describe touched the
		 * subscriber — order-dependent. The reset makes each test
		 * independently exercise the `initialized === false` regime.
		 */
		__mockState.selectors = {};
		__mockState.actions = {};
		__resetForTests();
		( createBlock as jest.Mock ).mockClear();
	} );

	it( 'does not convert legacy core/embed Strava blocks present at editor load', () => {
		// A post containing a Strava URL inside a `core/embed` block
		// before this plugin started watching should stay as-is until
		// the user opts in via the toolbar. Silent rewriting on the
		// first unrelated edit dirties the post and surprises the
		// author. Pin that the very first walk records the clientId
		// without dispatching `replaceBlock`.
		const cid = uniqueClientId( 'legacy' );
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/legacy-1',
				},
			},
		] );
		fireSubscribers();
		expect( replaceBlock ).not.toHaveBeenCalled();
	} );

	it( 'still does not convert legacy clientIds on subsequent ticks', () => {
		// The clientIds recorded on the first walk sit in the
		// watcher's skip set permanently, even when the same block
		// reappears on later ticks. Toolbar transform remains the
		// explicit conversion path.
		const cid = uniqueClientId( 'legacy' );
		setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/1',
				},
			},
		] );
		fireSubscribers();
		const { replaceBlock } = setEditorBlocks( [
			{
				clientId: cid,
				name: 'core/embed',
				attributes: {
					url: 'https://www.strava.com/activities/1',
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
		 * Reset the mocked data store and the production watcher.
		 * `__resetForTests` puts the module back to its post-load
		 * shape (`initialized=false`, empty skip set). Each test then
		 * arms post-init by firing once with empty blocks, so the
		 * conversion-testing flow below sees the same starting state
		 * regardless of test order or what previous describes did.
		 */
		__mockState.selectors = {};
		__mockState.actions = {};
		__resetForTests();
		( createBlock as jest.Mock ).mockClear();
		setEditorBlocks( [] );
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
		/*
		 * Pasting a Strava URL into post content fires two state
		 * changes back-to-back: Gutenberg's URL paste creates a
		 * `core/embed`, then our subscriber replaces it with our
		 * block. Without `__unstableMarkNextChangeAsNotPersistent`,
		 * those become two undo entries — the first Cmd+Z lands the
		 * user on the broken intermediate `core/embed` instead of
		 * undoing the paste outright. Pin that we call the marker
		 * BEFORE `replaceBlock` so the merge happens on the correct
		 * dispatch.
		 */
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
		/*
		 * The auto-replacer must round-trip the same wrapper attributes
		 * the toolbar transform copies through. Otherwise a user who
		 * pasted a Strava URL into a `core/embed` they had already
		 * styled (alignment, anchor, custom class) or captioned would
		 * lose that content during the silent auto-conversion.
		 */
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
		const { replaceBlock } = setEditorBlocks( blocks );
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
		// `subscribe` can fire on a tick where the store hasn't booted
		// yet and `select('core/block-editor')` returns null. The
		// watcher must exit cleanly rather than crash the editor.
		__mockState.selectors[ 'core/block-editor' ] = undefined;
		expect( () => fireSubscribers() ).not.toThrow();
		expect( createBlock ).not.toHaveBeenCalled();
	} );
} );
