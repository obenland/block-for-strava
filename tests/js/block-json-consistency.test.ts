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

	it( 'wires editorScript and render via the file: protocol so wp-scripts and core resolve them', () => {
		// `register_block_type_from_metadata` reads these strings to find
		// the editor bundle and the render callback. Drift here is the
		// difference between a working block and one that silently fails
		// to register.
		expect( metadata.editorScript ).toBe( 'file:./index.js' );
		expect( metadata.render ).toBe( 'file:./render.php' );
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
