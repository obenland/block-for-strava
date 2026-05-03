/**
 * Pins block.json against the constants in `edit.tsx` that read the same
 * attributes. The Block Directory's discovery process keys off `block.json`,
 * so silent drift between the schema and the code that consumes it would
 * surface as inspector controls offering values the schema strips on save —
 * no test failure, just data loss.
 */
import metadata from '../../src/block.json';

interface AttributeSpec {
	type: string;
	default?: unknown;
	enum?: ReadonlyArray< string >;
}

const ATTRS = metadata.attributes as Record< string, AttributeSpec >;

describe( 'block.json schema', () => {
	it( 'declares the route + token + caption attributes the editor + render callback both read', () => {
		expect( Object.keys( ATTRS ).sort() ).toEqual(
			[
				'caption',
				'stravaEmbedToken',
				'stravaRouteFullWidth',
				'stravaRouteMapStyle',
				'stravaRouteShowDirt',
				'stravaRouteShowElevation',
				'stravaRouteTerrain',
				'stravaRouteUnits',
				'url',
			].sort()
		);
	} );

	it( 'declares supports.anchor so the editor surfaces the HTML-anchor UI', () => {
		/*
		 * The PHP render test pins that an `anchor` attribute reaches
		 * the rendered figure, but only when the attribute is present.
		 * If `supports.anchor` ever goes missing from `block.json`,
		 * the editor's HTML-anchor inspector control disappears
		 * (Gutenberg keys it off the support flag), so users can
		 * never set the attribute in the first place. Pin the flag
		 * here so a `block.json` regression fails this test before
		 * the missing UI surfaces in the editor.
		 */
		const supports = metadata.supports as Record< string, unknown >;
		expect( supports.anchor ).toBe( true );
	} );

	it( 'declares stravaEmbedToken as a string defaulting to empty', () => {
		// The snippet-paste path writes this attribute; URL-only pastes
		// leave it empty. The default has to be `''` (not `undefined`)
		// because both the JS `buildEmbedUrl` and the PHP render callback
		// gate on a strict `'' !== token` check — `undefined` would
		// short-circuit to "no token" but a hand-edited block storing
		// `null` could slip through into the iframe URL otherwise.
		expect( ATTRS.stravaEmbedToken ).toMatchObject( {
			type: 'string',
			default: '',
		} );
	} );

	it( 'declares the map-style enum the inspector renders', () => {
		expect( ATTRS.stravaRouteMapStyle.enum ).toEqual( [
			'standard',
			'satellite',
			'hybrid',
			'dark',
			'winter',
			'light',
		] );
		expect( ATTRS.stravaRouteMapStyle.default ).toBe( 'standard' );
	} );

	it( 'declares the units enum the inspector renders', () => {
		expect( ATTRS.stravaRouteUnits.enum ).toEqual( [
			'auto',
			'metric',
			'imperial',
		] );
		expect( ATTRS.stravaRouteUnits.default ).toBe( 'auto' );
	} );

	it( 'declares the terrain enum the inspector renders', () => {
		expect( ATTRS.stravaRouteTerrain.enum ).toEqual( [
			'auto',
			'2d',
			'3d',
		] );
		expect( ATTRS.stravaRouteTerrain.default ).toBe( 'auto' );
	} );

	it( 'declares the boolean attributes with the defaults clampBool falls back to', () => {
		expect( ATTRS.stravaRouteFullWidth ).toMatchObject( {
			type: 'boolean',
			default: false,
		} );
		expect( ATTRS.stravaRouteShowDirt ).toMatchObject( {
			type: 'boolean',
			default: false,
		} );
		expect( ATTRS.stravaRouteShowElevation ).toMatchObject( {
			type: 'boolean',
			default: true,
		} );
	} );

	it( 'wires editorScript via the file: protocol so wp-scripts and core resolve it', () => {
		// `register_block_type_from_metadata` reads this string to find
		// the editor bundle. Drift here is the difference between a
		// working block and one that silently fails to register. The
		// render callback is wired in PHP, so block.json carries no
		// `render` key.
		expect( metadata.editorScript ).toBe( 'file:./index.js' );
		expect(
			( metadata as Record< string, unknown > ).render
		).toBeUndefined();
	} );

	it( 'sets the block category to embed for inserter placement', () => {
		expect( metadata.category ).toBe( 'embed' );
	} );

	it( 'declares "Strava" as the source-language title', () => {
		// The Block Directory listing renders block.json's title verbatim;
		// the in-editor title comes through `__()` which can be translated.
		// This test pins the source-language invariant — locale-dependent
		// runtime checks belong in e2e against `getBlockType().title`.
		expect( metadata.title ).toBe( 'Strava' );
	} );
} );
