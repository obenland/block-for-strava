/**
 * Edit-component coverage for the Strava embed block.
 *
 * Three rendering states to pin:
 * - Empty/edit-mode → `Placeholder` with a URL input form.
 * - Canonical Strava URL → iframe pointing at strava-embeds.com, with
 *   route options inspector for /routes URLs.
 * - Short URL (`strava.app.link/...`) → notice (server resolves on render).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';

import {
	Edit,
	buildEmbedUrl,
	parseStravaHeightMessage,
	parseStravaUrl,
	StravaRouteInspector,
} from '../../src/edit';

interface EditProps {
	attributes: {
		url?: string;
		stravaRouteMapStyle?: string;
		stravaRouteUnits?: string;
		stravaRouteTerrain?: string;
		stravaRouteFullWidth?: boolean;
		stravaRouteShowDirt?: boolean;
		stravaRouteShowElevation?: boolean;
	};
	setAttributes: ( attrs: Partial< EditProps[ 'attributes' ] > ) => void;
}

describe( 'Edit', () => {
	it( 'shows the URL placeholder when the URL is empty', () => {
		render(
			createElement( Edit, {
				attributes: {},
				setAttributes: jest.fn(),
			} )
		);
		expect(
			screen.getByRole( 'textbox', { name: /embed url/i } )
		).toBeInTheDocument();
		// No iframe before a URL is set.
		expect(
			document.querySelector( 'iframe.strava-embed-iframe' )
		).toBeNull();
	} );

	it( 'commits the typed URL via setAttributes on submit', async () => {
		const setAttributes = jest.fn();
		render( createElement( Edit, { attributes: {}, setAttributes } ) );
		const input = screen.getByRole( 'textbox', { name: /embed url/i } );
		await userEvent.type( input, 'https://www.strava.com/activities/123' );
		await userEvent.click(
			screen.getByRole( 'button', { name: /^embed$/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/activities/123',
		} );
	} );

	it( 'trims whitespace from the submitted URL', async () => {
		const setAttributes = jest.fn();
		render( createElement( Edit, { attributes: {}, setAttributes } ) );
		const input = screen.getByRole( 'textbox', { name: /embed url/i } );
		await userEvent.type(
			input,
			'  https://www.strava.com/activities/999  '
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /^embed$/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/activities/999',
		} );
	} );

	it( 'renders the iframe (no inspector) for activity URLs', () => {
		const { container } = render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		const iframe = container.querySelector(
			'iframe.strava-embed-iframe'
		) as HTMLIFrameElement | null;
		expect( iframe?.getAttribute( 'src' ) ).toBe(
			'https://strava-embeds.com/activity/123'
		);
		expect( screen.queryByTestId( 'inspector-controls' ) ).toBeNull();
	} );

	it( 'disables pointer events on the iframe so the block stays selectable', () => {
		// Without `pointer-events: none`, clicks land on the cross-origin
		// strava-embeds.com document and never reach the figure that holds
		// useBlockProps's selection handler — the user can no longer pick
		// the block after pasting a Strava URL.
		const { container } = render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		const iframe = container.querySelector< HTMLIFrameElement >(
			'iframe.strava-embed-iframe'
		);
		expect( iframe?.style.pointerEvents ).toBe( 'none' );
	} );

	it( 'renders the iframe + inspector for route URLs', () => {
		const { container } = render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/routes/456',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect(
			screen.getByTestId( 'inspector-controls' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'region', { name: /route options/i } )
		).toBeInTheDocument();
		const iframe = container.querySelector( 'iframe.strava-embed-iframe' );
		expect( iframe?.getAttribute( 'src' ) ).toBe(
			'https://strava-embeds.com/route/456'
		);
	} );

	it( 'reflects route attribute changes live in the iframe URL', () => {
		const { container } = render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/routes/456',
					stravaRouteMapStyle: 'satellite',
					stravaRouteTerrain: '3d',
					stravaRouteUnits: 'metric',
					stravaRouteShowDirt: true,
					stravaRouteFullWidth: true,
					stravaRouteShowElevation: false,
				},
				setAttributes: jest.fn(),
			} )
		);
		const src = container
			.querySelector( 'iframe.strava-embed-iframe' )
			?.getAttribute( 'src' );
		expect( src ).toBeDefined();
		const params = new URL( src as string ).searchParams;
		expect( params.get( 'style' ) ).toBe( 'satellite' );
		expect( params.get( 'terrain' ) ).toBe( '3d' );
		expect( params.get( 'units' ) ).toBe( 'metric' );
		expect( params.get( 'fullWidth' ) ).toBe( 'true' );
		expect( params.get( 'surfaceType' ) ).toBe( 'true' );
		expect( params.get( 'hideElevation' ) ).toBe( 'true' );
	} );

	it( 'drops the iframe max-width when fullWidth is enabled', () => {
		const { container } = render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/routes/456',
					stravaRouteFullWidth: true,
				},
				setAttributes: jest.fn(),
			} )
		);
		const iframe = container.querySelector(
			'iframe.strava-embed-iframe'
		) as HTMLIFrameElement;
		expect( iframe.style.maxWidth ).toBe( '' );
		expect( iframe.style.width ).toBe( '100%' );
	} );

	it( 'keeps the iframe max-width clamp at fullWidth=false (default)', () => {
		const { container } = render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/routes/456',
				},
				setAttributes: jest.fn(),
			} )
		);
		const iframe = container.querySelector(
			'iframe.strava-embed-iframe'
		) as HTMLIFrameElement;
		expect( iframe.style.maxWidth ).toBe( '600px' );
	} );

	it( 'shows a passthrough notice for short URLs', () => {
		// Short URLs require a server-side HEAD-redirect chase to map to a
		// canonical type+id; the editor preview can't render an iframe
		// directly without a REST round-trip. Show a notice instead — the
		// PHP render callback resolves the short URL on publish.
		render(
			createElement( Edit, {
				attributes: { url: 'https://strava.app.link/abc' },
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.getByText( /short url/i ) ).toBeInTheDocument();
		expect(
			document.querySelector( 'iframe.strava-embed-iframe' )
		).toBeNull();
	} );

	it( 'shows the unrecognized-URL notice for non-Strava input', () => {
		render(
			createElement( Edit, {
				attributes: { url: 'https://example.com/foo' },
				setAttributes: jest.fn(),
			} )
		);
		expect(
			screen.getByText( /not a recognized strava/i )
		).toBeInTheDocument();
	} );

	describe( 'Edit URL toolbar button', () => {
		it( 'exposes a pencil button on the rendered preview', () => {
			render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			expect(
				screen.getByRole( 'button', { name: /edit url/i } )
			).toBeInTheDocument();
		} );

		it( 'switches to the placeholder when clicked', async () => {
			const { container } = render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			await userEvent.click(
				screen.getByRole( 'button', { name: /edit url/i } )
			);
			expect(
				screen.getByRole( 'textbox', { name: /embed url/i } )
			).toBeInTheDocument();
			expect(
				container.querySelector( 'iframe.strava-embed-iframe' )
			).toBeNull();
		} );

		it( 'returns to the iframe when toggled off without saving', async () => {
			const setAttributes = jest.fn();
			const { container } = render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes,
				} )
			);
			const editButton = screen.getByRole( 'button', {
				name: /edit url/i,
			} );
			await userEvent.click( editButton );
			await userEvent.click( editButton );
			expect( setAttributes ).not.toHaveBeenCalled();
			expect(
				container.querySelector( 'iframe.strava-embed-iframe' )
			).not.toBeNull();
		} );
	} );

	describe( 'iframe height messaging', () => {
		it( 'sizes the iframe from BROADCAST_IFRAME_HEIGHT messages', () => {
			const { container } = render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			const iframe = container.querySelector< HTMLIFrameElement >(
				'iframe.strava-embed-iframe'
			);
			expect( iframe ).not.toBeNull();
			act( () => {
				fireEvent(
					window,
					new MessageEvent( 'message', {
						data: [ 0, 'BROADCAST_IFRAME_HEIGHT', 405 ],
						source: iframe?.contentWindow,
					} )
				);
			} );
			expect( iframe?.style.height ).toBe( '405px' );
		} );

		it( 'ignores non-height messages', () => {
			const { container } = render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			const iframe = container.querySelector< HTMLIFrameElement >(
				'iframe.strava-embed-iframe'
			);
			const initialHeight = iframe?.style.height;
			act( () => {
				fireEvent(
					window,
					new MessageEvent( 'message', {
						data: { unrelated: 'analytics' },
						source: iframe?.contentWindow,
					} )
				);
			} );
			expect( iframe?.style.height ).toBe( initialHeight );
		} );

		it( 'ignores broadcasts from other windows', () => {
			const { container } = render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			const iframe = container.querySelector< HTMLIFrameElement >(
				'iframe.strava-embed-iframe'
			);
			const initialHeight = iframe?.style.height;
			act( () => {
				fireEvent(
					window,
					new MessageEvent( 'message', {
						data: [ 0, 'BROADCAST_IFRAME_HEIGHT', 405 ],
						source: window,
					} )
				);
			} );
			expect( iframe?.style.height ).toBe( initialHeight );
		} );

		it( "routes the listener through the iframe's owner window", () => {
			// In Gutenberg's iframe-canvas mode (default since WP 6.3) the
			// block's DOM lives in a child iframe while React stays in the
			// admin window. Strava posts to its own `window.parent` = the
			// canvas window — a listener on `window` never fires. Mounting
			// in a nested iframe and asserting the listener attaches to
			// *that* iframe's window proves the wired path works.
			const hostIframe = document.createElement( 'iframe' );
			document.body.appendChild( hostIframe );
			const hostDoc = hostIframe.contentDocument as Document;
			const hostWindow = hostIframe.contentWindow as Window;
			const mountPoint = hostDoc.createElement( 'div' );
			hostDoc.body.appendChild( mountPoint );

			const outerCalls: string[] = [];
			const hostCalls: string[] = [];
			const outerOriginal = window.addEventListener.bind( window );
			const hostOriginal = hostWindow.addEventListener.bind( hostWindow );
			window.addEventListener = ( ( ...args: unknown[] ) => {
				if ( 'message' === args[ 0 ] ) {
					outerCalls.push( 'outer' );
				}
				return outerOriginal(
					...( args as Parameters< typeof outerOriginal > )
				);
			} ) as typeof window.addEventListener;
			hostWindow.addEventListener = ( ( ...args: unknown[] ) => {
				if ( 'message' === args[ 0 ] ) {
					hostCalls.push( 'host' );
				}
				return hostOriginal(
					...( args as Parameters< typeof hostOriginal > )
				);
			} ) as typeof hostWindow.addEventListener;

			try {
				render(
					createElement( Edit, {
						attributes: {
							url: 'https://www.strava.com/activities/123',
						},
						setAttributes: jest.fn(),
					} ),
					{ container: mountPoint }
				);

				expect( hostCalls.length ).toBeGreaterThan( 0 );
				expect( outerCalls.length ).toBe( 0 );
			} finally {
				window.addEventListener = outerOriginal;
				hostWindow.addEventListener = hostOriginal;
				document.body.removeChild( hostIframe );
			}
		} );
	} );
} );

describe( 'parseStravaUrl', () => {
	it( 'recognizes canonical activity, route, and segment URLs', () => {
		expect(
			parseStravaUrl( 'https://www.strava.com/activities/123' )
		).toEqual( { type: 'activity', id: '123' } );
		expect( parseStravaUrl( 'https://www.strava.com/routes/456' ) ).toEqual(
			{ type: 'route', id: '456' }
		);
		expect(
			parseStravaUrl( 'https://www.strava.com/segments/789' )
		).toEqual( { type: 'segment', id: '789' } );
	} );

	it( 'accepts subdomains and trailing path segments', () => {
		expect(
			parseStravaUrl( 'https://app.strava.com/activities/123/overview' )
		).toEqual( { type: 'activity', id: '123' } );
	} );

	it( 'rejects non-Strava hosts and unsupported paths', () => {
		expect(
			parseStravaUrl( 'https://example.com/activities/123' )
		).toBeNull();
		expect(
			parseStravaUrl( 'https://www.strava.com/clubs/123' )
		).toBeNull();
		expect( parseStravaUrl( 'https://strava.app.link/abc' ) ).toBeNull();
	} );

	it( 'rejects ID-with-suffix lookalikes (boundary check)', () => {
		// Without the `(?=[/?#]|$)` guard, /activities/123abc would silently
		// match as activity 123 and we'd embed the wrong resource.
		expect(
			parseStravaUrl( 'https://www.strava.com/activities/123abc' )
		).toBeNull();
	} );
} );

describe( 'buildEmbedUrl', () => {
	it( 'returns a clean URL for non-route types', () => {
		expect( buildEmbedUrl( { type: 'activity', id: '123' }, {} ) ).toBe(
			'https://strava-embeds.com/activity/123'
		);
		expect( buildEmbedUrl( { type: 'segment', id: '789' }, {} ) ).toBe(
			'https://strava-embeds.com/segment/789'
		);
	} );

	it( 'returns a clean URL for routes at defaults', () => {
		expect( buildEmbedUrl( { type: 'route', id: '456' }, {} ) ).toBe(
			'https://strava-embeds.com/route/456'
		);
	} );

	it( 'omits route params when set to default values', () => {
		expect(
			buildEmbedUrl(
				{ type: 'route', id: '456' },
				{
					stravaRouteMapStyle: 'standard',
					stravaRouteTerrain: 'auto',
					stravaRouteUnits: 'auto',
					stravaRouteShowDirt: false,
					stravaRouteFullWidth: false,
					stravaRouteShowElevation: true,
				}
			)
		).toBe( 'https://strava-embeds.com/route/456' );
	} );

	it( 'emits each non-default route param', () => {
		const url = new URL(
			buildEmbedUrl(
				{ type: 'route', id: '456' },
				{
					stravaRouteMapStyle: 'satellite',
					stravaRouteTerrain: '3d',
					stravaRouteUnits: 'metric',
					stravaRouteShowDirt: true,
					stravaRouteFullWidth: true,
					stravaRouteShowElevation: false,
				}
			)
		);
		expect( url.pathname ).toBe( '/route/456' );
		expect( url.searchParams.get( 'style' ) ).toBe( 'satellite' );
		expect( url.searchParams.get( 'terrain' ) ).toBe( '3d' );
		expect( url.searchParams.get( 'units' ) ).toBe( 'metric' );
		expect( url.searchParams.get( 'surfaceType' ) ).toBe( 'true' );
		expect( url.searchParams.get( 'fullWidth' ) ).toBe( 'true' );
		expect( url.searchParams.get( 'hideElevation' ) ).toBe( 'true' );
	} );

	it( 'clamps invalid stored values back to defaults (no params emitted)', () => {
		expect(
			buildEmbedUrl(
				{ type: 'route', id: '456' },
				{
					stravaRouteMapStyle: 'bogus',
					stravaRouteTerrain: 'flat',
					stravaRouteUnits: 'imperial-ish',
				}
			)
		).toBe( 'https://strava-embeds.com/route/456' );
	} );

	it( 'includes default `style=standard` when any other param is set, matching PHP', () => {
		// Without this, the editor preview URL (`?terrain=3d`) and the
		// published URL (`?style=standard&terrain=3d`) would differ for
		// the same saved attributes — minor on Strava's end, but enough
		// to surface as two distinct cache keys downstream.
		const url = new URL(
			buildEmbedUrl(
				{ type: 'route', id: '456' },
				{ stravaRouteTerrain: '3d' }
			)
		);
		expect( url.searchParams.get( 'style' ) ).toBe( 'standard' );
		expect( url.searchParams.get( 'terrain' ) ).toBe( '3d' );
	} );
} );

describe( 'parseStravaHeightMessage', () => {
	it( 'returns the height for a well-formed BROADCAST_IFRAME_HEIGHT array', () => {
		expect(
			parseStravaHeightMessage( [ 0, 'BROADCAST_IFRAME_HEIGHT', 412 ] )
		).toBe( 412 );
	} );

	it( 'clamps unreasonably small heights up to the floor', () => {
		expect(
			parseStravaHeightMessage( [ 0, 'BROADCAST_IFRAME_HEIGHT', 10 ] )
		).toBe( 100 );
	} );

	it( 'clamps unreasonably large heights down to the ceiling', () => {
		expect(
			parseStravaHeightMessage( [ 0, 'BROADCAST_IFRAME_HEIGHT', 99999 ] )
		).toBe( 5000 );
	} );

	it( 'rejects non-array payloads', () => {
		expect(
			parseStravaHeightMessage( 'BROADCAST_IFRAME_HEIGHT' )
		).toBeNull();
		expect(
			parseStravaHeightMessage( { stravaEmbedHeight: 500 } )
		).toBeNull();
		expect( parseStravaHeightMessage( null ) ).toBeNull();
	} );

	it( 'rejects arrays with the wrong tag', () => {
		expect(
			parseStravaHeightMessage( [ 0, 'OTHER_MESSAGE', 500 ] )
		).toBeNull();
	} );

	it( 'rejects non-numeric heights', () => {
		expect(
			parseStravaHeightMessage( [
				0,
				'BROADCAST_IFRAME_HEIGHT',
				'500px',
			] )
		).toBeNull();
		expect(
			parseStravaHeightMessage( [
				0,
				'BROADCAST_IFRAME_HEIGHT',
				Number.NaN,
			] )
		).toBeNull();
		expect(
			parseStravaHeightMessage( [
				0,
				'BROADCAST_IFRAME_HEIGHT',
				Number.POSITIVE_INFINITY,
			] )
		).toBeNull();
	} );
} );

describe( 'StravaRouteInspector', () => {
	function renderWith( attributes: EditProps[ 'attributes' ] = {} ) {
		const setAttributes = jest.fn();
		render(
			createElement( StravaRouteInspector, {
				attributes,
				setAttributes,
			} )
		);
		return setAttributes;
	}

	it( 'toggles `stravaRouteShowElevation`', async () => {
		const setAttributes = renderWith( { stravaRouteShowElevation: true } );
		await userEvent.click(
			screen.getByRole( 'switch', { name: /show elevation profile/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteShowElevation: false,
		} );
	} );

	it( 'changes `stravaRouteUnits`', async () => {
		const setAttributes = renderWith();
		await userEvent.click(
			screen.getByRole( 'radio', { name: /units: metric/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteUnits: 'metric',
		} );
	} );

	it( 'maps fullWidth radio to the boolean attribute', async () => {
		const setAttributes = renderWith();
		await userEvent.click(
			screen.getByRole( 'radio', { name: /embed width: responsive/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteFullWidth: true,
		} );
	} );

	it( 'reflects a stored fullWidth=true as the responsive radio', () => {
		renderWith( { stravaRouteFullWidth: true } );
		expect(
			screen.getByRole( 'radio', { name: /embed width: responsive/i } )
		).toBeChecked();
	} );

	it( 'changes `stravaRouteMapStyle`', async () => {
		const setAttributes = renderWith();
		await userEvent.selectOptions(
			screen.getByRole( 'combobox', { name: /map style/i } ),
			'satellite'
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteMapStyle: 'satellite',
		} );
	} );

	it( 'changes `stravaRouteTerrain`', async () => {
		const setAttributes = renderWith();
		await userEvent.click(
			screen.getByRole( 'radio', { name: /terrain: 3d/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteTerrain: '3d',
		} );
	} );

	it( 'toggles `stravaRouteShowDirt`', async () => {
		const setAttributes = renderWith();
		await userEvent.click(
			screen.getByRole( 'switch', {
				name: /highlight unpaved surfaces/i,
			} )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			stravaRouteShowDirt: true,
		} );
	} );

	it( 'clamps unknown stored values back to defaults', () => {
		renderWith( {
			stravaRouteMapStyle: 'invalid',
			stravaRouteTerrain: 'bogus',
			stravaRouteUnits: 'unknown',
		} );
		expect(
			screen.getByRole( 'combobox', { name: /map style/i } )
		).toHaveValue( 'standard' );
		expect(
			screen.getByRole( 'radio', { name: /terrain: auto/i } )
		).toBeChecked();
		expect(
			screen.getByRole( 'radio', { name: /units: auto/i } )
		).toBeChecked();
	} );
} );
