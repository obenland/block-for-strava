/**
 * Verifies the `core/embed` block variation that captures Strava URLs.
 *
 * The variation is the entry point for the magical paste flow: when a user
 * pastes a Strava URL into the editor, core/embed walks the registered
 * variations and uses the first whose `patterns` regexes match. If our
 * patterns drift (e.g. drop short URLs, add a typo) the magical conversion
 * silently breaks — these tests pin the registered shape.
 */
import { registerBlockVariation } from '@wordpress/blocks';

import '../../src/embed-variation';

interface Variation {
	patterns: ReadonlyArray< RegExp >;
	name: string;
	attributes: { providerNameSlug: string; responsive: boolean };
	isActive: ReadonlyArray< string >;
	title: string;
	description: string;
	keywords: ReadonlyArray< string >;
	icon: unknown;
}

const calls = ( registerBlockVariation as jest.Mock ).mock.calls;
const blockName: string = calls[ 0 ]?.[ 0 ];
const variation: Variation = calls[ 0 ]?.[ 1 ];

const matches = ( url: string ) =>
	variation.patterns.some( ( re ) => re.test( url ) );

describe( 'core/embed Strava variation', () => {
	it( 'registers exactly one variation against core/embed', () => {
		expect( calls ).toHaveLength( 1 );
		expect( blockName ).toBe( 'core/embed' );
	} );

	it( 'sets provider slug to "strava" and is responsive by default', () => {
		expect( variation.name ).toBe( 'strava' );
		expect( variation.attributes.providerNameSlug ).toBe( 'strava' );
		expect( variation.attributes.responsive ).toBe( true );
	} );

	it( 'matches canonical activity, route, and segment URLs', () => {
		expect(
			matches( 'https://www.strava.com/activities/18233733854' )
		).toBe( true );
		expect( matches( 'http://strava.com/activities/123' ) ).toBe( true );
		expect(
			matches( 'https://www.strava.com/routes/3379104463896442748' )
		).toBe( true );
		expect( matches( 'https://www.strava.com/segments/789' ) ).toBe( true );
		expect(
			matches( 'https://www.strava.com/activities/123/overview?foo=1' )
		).toBe( true );
		// `app.strava.com` is what the mobile share dialog produces; the PHP
		// parser already accepts it so the JS variation must too, otherwise
		// pasting that URL silently dead-ends in the editor. Multi-level
		// subdomains (`foo.bar.strava.com`) round-trip the same way because
		// the server-side host check uses `str_ends_with`.
		expect( matches( 'https://app.strava.com/activities/123' ) ).toBe(
			true
		);
		expect( matches( 'https://foo.bar.strava.com/routes/456' ) ).toBe(
			true
		);
	} );

	it( 'matches strava.app.link short URLs', () => {
		expect( matches( 'https://strava.app.link/abc123' ) ).toBe( true );
		expect( matches( 'http://strava.app.link/xyz' ) ).toBe( true );
	} );

	it( 'rejects non-Strava URLs and unsupported strava.com paths', () => {
		expect( matches( 'https://example.com/activities/123' ) ).toBe( false );
		expect( matches( 'https://www.strava.com/clubs/123' ) ).toBe( false );
		expect( matches( 'https://www.strava.com/athletes/abc' ) ).toBe(
			false
		);
		// /activities/<not digits> must not match — the embed.js placeholder
		// requires a numeric id and would silently fail to render otherwise.
		expect( matches( 'https://www.strava.com/activities/abc' ) ).toBe(
			false
		);
		expect( matches( 'https://evilstrava.com/activities/123' ) ).toBe(
			false
		);
	} );

	it( 'isActive matches on providerNameSlug so saved blocks round-trip', () => {
		expect( variation.isActive ).toEqual( [ 'providerNameSlug' ] );
	} );

	it( 'declares Strava-specific keywords for inserter discovery', () => {
		expect( variation.keywords ).toEqual(
			expect.arrayContaining( [
				'strava',
				'activity',
				'route',
				'segment',
			] )
		);
	} );
} );
