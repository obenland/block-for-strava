/**
 * Verifies the `core/paragraph` → `block-for-strava/embed` transform that
 * lets a user convert a typed paragraph containing a Strava URL via the
 * block toolbar.
 *
 * Inserter discovery covers the cold-start path; this filter covers the
 * case where the URL is already inside a paragraph and the user picks
 * "Transform to Strava".
 */
import { applyFilters } from '@wordpress/hooks';
import { createBlock } from '@wordpress/blocks';

import '../../src/paragraph-transform';

interface BlockTransform {
	type: 'block';
	blocks: ReadonlyArray< string >;
	isMatch: ( attrs: { content?: unknown } ) => boolean;
	transform: ( attrs: { content?: unknown } ) => unknown;
}

interface ParagraphSettings {
	transforms?: { to?: ReadonlyArray< BlockTransform > };
}

function runFilter(
	settings: ParagraphSettings,
	name: string
): ParagraphSettings {
	return applyFilters(
		'blocks.registerBlockType',
		settings,
		name
	) as ParagraphSettings;
}

describe( 'core/paragraph → block-for-strava/embed transform', () => {
	it( 'leaves non-paragraph block settings untouched', () => {
		const settings = { transforms: { to: [] } };
		const result = runFilter( settings, 'core/heading' );
		expect( result ).toBe( settings );
	} );

	it( 'adds a single block transform targeting block-for-strava/embed', () => {
		const result = runFilter( {}, 'core/paragraph' );
		const to = result.transforms?.to ?? [];
		expect( to ).toHaveLength( 1 );
		expect( to[ 0 ].type ).toBe( 'block' );
		expect( to[ 0 ].blocks ).toEqual( [ 'block-for-strava/embed' ] );
	} );

	it( 'preserves existing transforms', () => {
		const existing: BlockTransform = {
			type: 'block',
			blocks: [ 'core/heading' ],
			isMatch: () => true,
			transform: () => ( {} ),
		};
		const result = runFilter(
			{ transforms: { to: [ existing ] } },
			'core/paragraph'
		);
		expect( result.transforms?.to?.[ 0 ] ).toBe( existing );
		expect( result.transforms?.to ).toHaveLength( 2 );
	} );

	describe( 'isMatch', () => {
		const result = runFilter( {}, 'core/paragraph' );
		const isMatch = result.transforms?.to?.[ 0 ]?.isMatch;
		if ( ! isMatch ) {
			throw new Error( 'transform isMatch missing' );
		}

		it.each( [
			[ 'https://www.strava.com/activities/18233733854' ],
			[ 'https://strava.com/activities/123' ],
			[ 'https://www.strava.com/routes/3379104463896442748' ],
			[ 'https://www.strava.com/segments/789' ],
			[ 'https://app.strava.com/activities/123' ],
			[ 'https://www.strava.com/activities/123/overview?foo=1' ],
			[ 'https://strava.app.link/abc123' ],
			// Wrapped in an anchor as the editor's autolinker would produce.
			[
				'<a href="https://www.strava.com/activities/123">https://www.strava.com/activities/123</a>',
			],
		] )( 'matches Strava URL: %s', ( content ) => {
			expect( isMatch( { content } ) ).toBe( true );
		} );

		it.each( [
			[ '' ],
			[ 'just some text' ],
			[ 'https://example.com/foo' ],
			[ 'https://www.strava.com/clubs/123' ],
			// /activities/<not digits> — embed.js can't render it.
			[ 'https://www.strava.com/activities/abc' ],
			// URL plus extra text in the same paragraph — would lose the rest
			// of the content if we converted, so refuse.
			[
				'check this out https://www.strava.com/activities/123 cool right',
			],
			// Lookalike host.
			[ 'https://evilstrava.com/activities/123' ],
			// Anchor whose href is non-Strava — the autolinker shape matches
			// but the URL doesn't, so we should refuse.
			[ '<a href="https://example.com/foo">https://example.com/foo</a>' ],
		] )( 'rejects non-Strava-URL content: %s', ( content ) => {
			expect( isMatch( { content } ) ).toBe( false );
		} );

		it( 'rejects non-string content (RichText fallback)', () => {
			expect( isMatch( { content: 123 } ) ).toBe( false );
			expect( isMatch( { content: undefined } ) ).toBe( false );
			expect( isMatch( { content: null } ) ).toBe( false );
		} );
	} );

	describe( 'transform', () => {
		const result = runFilter( {}, 'core/paragraph' );
		const transformFn = result.transforms?.to?.[ 0 ]?.transform;
		if ( ! transformFn ) {
			throw new Error( 'transform fn missing' );
		}

		beforeEach( () => {
			( createBlock as jest.Mock ).mockClear();
		} );

		it( 'creates a block-for-strava/embed block with the URL', () => {
			transformFn( {
				content: 'https://www.strava.com/activities/18233733854',
			} );
			expect( createBlock ).toHaveBeenCalledWith(
				'block-for-strava/embed',
				{
					url: 'https://www.strava.com/activities/18233733854',
				}
			);
		} );

		it( 'unwraps anchor markup before storing the URL', () => {
			transformFn( {
				content:
					'<a href="https://www.strava.com/routes/456">https://www.strava.com/routes/456</a>',
			} );
			expect( createBlock ).toHaveBeenCalledWith(
				'block-for-strava/embed',
				expect.objectContaining( {
					url: 'https://www.strava.com/routes/456',
				} )
			);
		} );

		it( 'decodes HTML entities from the anchor href before saving', () => {
			// RichText serializes `&` in attribute values as `&amp;`, so a
			// pasted query-string URL round-trips with entity-encoded
			// ampersands. Storing the encoded form would persist a URL
			// that doesn't match what the user actually pasted.
			transformFn( {
				content:
					'<a href="https://www.strava.com/activities/789?foo=1&amp;bar=2">https://www.strava.com/activities/789?foo=1&amp;bar=2</a>',
			} );
			expect( createBlock ).toHaveBeenCalledWith(
				'block-for-strava/embed',
				expect.objectContaining( {
					url: 'https://www.strava.com/activities/789?foo=1&bar=2',
				} )
			);
		} );

		it( 'falls back to an empty URL if called with non-matching content', () => {
			// Defensive branch: Gutenberg only invokes transform after isMatch
			// returns true, so this should never happen in production. Exercise
			// it anyway so the fallback can't silently emit `null` as a URL.
			transformFn( { content: 'not a strava url at all' } );
			expect( createBlock ).toHaveBeenCalledWith(
				'block-for-strava/embed',
				expect.objectContaining( { url: '' } )
			);
		} );
	} );
} );
