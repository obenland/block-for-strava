/**
 * Verifies the Strava-embed-snippet → block-for-strava/embed paste path.
 *
 * Strava's share dialog hands users a `<div class="strava-embed-placeholder"
 * data-embed-id data-embed-type data-token>...</div><script src="…"></script>`
 * snippet for activities that aren't public-Everyone (and therefore can't be
 * embedded by URL alone — strava-embeds.com 403s without a `?token=`). The
 * raw transform registered here lets a user paste that snippet on its own
 * line and have it converted into our block with the token preserved as a
 * block attribute. Without this path, token-gated activities have no way
 * into the plugin at all.
 */
import { applyFilters } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

import '../../src/snippet-transform';

interface RawTransform {
	type: 'raw';
	isMatch: ( node: Node ) => boolean;
	transform: ( node: Node ) => unknown;
	schema?: () => Record< string, unknown >;
	[ key: string ]: unknown;
}

interface BlockSettings {
	transforms?: { from?: ReadonlyArray< RawTransform > };
	[ key: string ]: unknown;
}

function runFilter( settings: BlockSettings, name: string ): BlockSettings {
	return applyFilters(
		'blocks.registerBlockType',
		settings,
		name
	) as BlockSettings;
}

/**
 * Builds a `<div class="strava-embed-placeholder" …>` element matching the
 * shape Strava's share dialog produces.
 *
 * @param attrs Map of data-* attribute names (without the `data-` prefix)
 *              to values. Anything in here lands as a `data-{key}` attr
 *              on the element.
 */
function makePlaceholder( attrs: Record< string, string > ): HTMLDivElement {
	const div = document.createElement( 'div' );
	div.className = 'strava-embed-placeholder';
	for ( const [ key, value ] of Object.entries( attrs ) ) {
		div.setAttribute( `data-${ key }`, value );
	}
	return div;
}

describe( 'block-for-strava/embed registerBlockType filter', () => {
	it( 'leaves non-target block settings untouched', () => {
		const settings: BlockSettings = { transforms: { from: [] } };
		const result = runFilter( settings, 'core/paragraph' );
		expect( result ).toBe( settings );
	} );

	it( 'adds a raw transform on block-for-strava/embed', () => {
		const result = runFilter( {}, 'block-for-strava/embed' );
		const from = result.transforms?.from ?? [];
		const snippet = from.find( ( t ) => 'raw' === t.type );
		expect( snippet ).toBeDefined();
	} );

	it( 'preserves existing from transforms', () => {
		const existing: RawTransform = {
			type: 'raw',
			isMatch: () => false,
			transform: () => ( {} ),
			selector: 'p.preexisting',
		};
		const result = runFilter(
			{ transforms: { from: [ existing ] } },
			'block-for-strava/embed'
		);
		expect( result.transforms?.from ).toContain( existing );
	} );
} );

describe( 'snippet raw transform isMatch', () => {
	const result = runFilter( {}, 'block-for-strava/embed' );
	const transforms = result.transforms?.from ?? [];
	const snippet = transforms.find( ( t ) => 'raw' === t.type );
	if ( ! snippet ) {
		throw new Error( 'snippet raw transform missing' );
	}
	const isMatch = snippet.isMatch;

	it( 'matches a Strava embed placeholder div with required data attrs', () => {
		const node = makePlaceholder( {
			'embed-type': 'activity',
			'embed-id': '18233733854',
			token: 'gS4P2Fvt-Vc',
		} );
		expect( isMatch( node ) ).toBe( true );
	} );

	it( 'matches placeholder for routes and segments too', () => {
		expect(
			isMatch(
				makePlaceholder( {
					'embed-type': 'route',
					'embed-id': '12345',
				} )
			)
		).toBe( true );
		expect(
			isMatch(
				makePlaceholder( {
					'embed-type': 'segment',
					'embed-id': '789',
				} )
			)
		).toBe( true );
	} );

	it( 'rejects placeholder lacking embed-id (token alone is not enough)', () => {
		// Without an id we can't build a valid iframe URL — refuse rather
		// than silently emit a broken block.
		const node = makePlaceholder( {
			'embed-type': 'activity',
			token: 'gS4P2Fvt-Vc',
		} );
		expect( isMatch( node ) ).toBe( false );
	} );

	it( 'rejects placeholder lacking embed-type', () => {
		const node = makePlaceholder( { 'embed-id': '123' } );
		expect( isMatch( node ) ).toBe( false );
	} );

	it( 'rejects placeholder with non-numeric embed-id', () => {
		// Strava's iframe path requires \d+; a non-digit id would 404 every
		// time, so don't even create the block.
		const node = makePlaceholder( {
			'embed-type': 'activity',
			'embed-id': 'abc',
		} );
		expect( isMatch( node ) ).toBe( false );
	} );

	it( 'rejects placeholder with unsupported embed-type', () => {
		const node = makePlaceholder( {
			'embed-type': 'club',
			'embed-id': '123',
		} );
		expect( isMatch( node ) ).toBe( false );
	} );

	it( 'rejects nodes without the placeholder class', () => {
		const node = document.createElement( 'div' );
		node.setAttribute( 'data-embed-type', 'activity' );
		node.setAttribute( 'data-embed-id', '123' );
		expect( isMatch( node ) ).toBe( false );
	} );

	it( 'rejects non-element nodes', () => {
		const text = document.createTextNode( 'placeholder' );
		expect( isMatch( text ) ).toBe( false );
	} );
} );

describe( 'snippet raw transform transform', () => {
	const result = runFilter( {}, 'block-for-strava/embed' );
	const transforms = result.transforms?.from ?? [];
	const snippet = transforms.find( ( t ) => 'raw' === t.type );
	if ( ! snippet ) {
		throw new Error( 'snippet raw transform missing' );
	}
	const transform = snippet.transform;

	beforeEach( () => {
		( createBlock as jest.Mock ).mockClear();
	} );

	it( 'creates a block-for-strava/embed block with the token preserved', () => {
		const node = makePlaceholder( {
			'embed-type': 'activity',
			'embed-id': '18233733854',
			token: 'gS4P2FvtBZlKXOaVgke3eG1ExyfzKWW18kKuXmYX-Vc',
		} );
		transform( node );
		expect( createBlock ).toHaveBeenCalledWith( 'block-for-strava/embed', {
			url: 'https://www.strava.com/activities/18233733854',
			stravaEmbedToken: 'gS4P2FvtBZlKXOaVgke3eG1ExyfzKWW18kKuXmYX-Vc',
		} );
	} );

	it( 'maps embed-type to canonical pluralized URL path', () => {
		const node = makePlaceholder( {
			'embed-type': 'route',
			'embed-id': '456',
		} );
		transform( node );
		expect( createBlock ).toHaveBeenCalledWith(
			'block-for-strava/embed',
			expect.objectContaining( {
				url: 'https://www.strava.com/routes/456',
			} )
		);
	} );

	it( 'normalizes a missing data-token to an empty string attribute', () => {
		// Strava only ships data-token on tokenized activities. For a
		// public-Everyone snippet (no token attr), we still set the block
		// attribute — to ''. That round-trips identically to "missing"
		// through block.json's `default: ''`, but keeping the attribute
		// always-present in the createBlock call simplifies the
		// always-string contract that buildEmbedUrl + the PHP renderer
		// both rely on for their `'' !== token` gate.
		const node = makePlaceholder( {
			'embed-type': 'segment',
			'embed-id': '789',
		} );
		transform( node );
		expect( createBlock ).toHaveBeenCalledWith( 'block-for-strava/embed', {
			url: 'https://www.strava.com/segments/789',
			stravaEmbedToken: '',
		} );
	} );
} );

describe( 'snippet raw transform schema', () => {
	const result = runFilter( {}, 'block-for-strava/embed' );
	const transforms = result.transforms?.from ?? [];
	const snippet = transforms.find( ( t ) => 'raw' === t.type );
	if ( ! snippet ) {
		throw new Error( 'snippet raw transform missing' );
	}

	it( 'whitelists the placeholder div + data-* attrs through removeInvalidHTML', () => {
		// Gutenberg's `pasteHandler` strips tags/attributes not declared by
		// any raw transform's `schema` BEFORE it asks `isMatch`. Without
		// this entry, the placeholder div arrives at `parsePlaceholder`
		// missing every `data-*` attribute and gets rejected — the snippet
		// path is dead in the real paste pipeline. Pin the exact shape
		// here so a future refactor of `schema()` can't silently regress
		// what the e2e test catches end-to-end.
		expect( snippet.schema ).toBeDefined();
		const schema = ( snippet.schema as () => Record< string, unknown > )();
		const div = schema.div as {
			attributes: string[];
			classes: string[];
		};
		expect( div.classes ).toEqual( [ 'strava-embed-placeholder' ] );
		expect( div.attributes ).toEqual(
			expect.arrayContaining( [
				'class',
				'data-embed-type',
				'data-embed-id',
				'data-token',
			] )
		);
	} );
} );
