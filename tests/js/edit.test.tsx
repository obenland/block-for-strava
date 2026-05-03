/**
 * Edit-component coverage for the Strava embed block.
 *
 * Three rendering states to pin:
 * - Empty/edit-mode → `Placeholder` with a URL input form.
 * - Canonical Strava URL → iframe pointing at strava-embeds.com, with
 *   route options inspector for /routes URLs.
 * - Short URL (`strava.app.link/...`) → notice (server resolves on render).
 */
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import apiFetch from '@wordpress/api-fetch';

import {
	Edit,
	buildEmbedUrl,
	parseStravaHeightMessage,
	parseStravaUrl,
	StravaRouteInspector,
} from '../../src/edit';

const mockedApiFetch = apiFetch as unknown as jest.Mock;

interface EditProps {
	attributes: {
		url?: string;
		stravaRouteMapStyle?: string;
		stravaRouteUnits?: string;
		stravaRouteTerrain?: string;
		stravaRouteFullWidth?: boolean;
		stravaRouteShowDirt?: boolean;
		stravaRouteShowElevation?: boolean;
		stravaEmbedToken?: string;
		caption?: string;
	};
	setAttributes: ( attrs: Partial< EditProps[ 'attributes' ] > ) => void;
	isSelected?: boolean;
}

beforeEach( () => {
	mockedApiFetch.mockReset();
	// Default: never-resolving promise so unrelated tests don't fall
	// through into setState-after-unmount warnings (the project's
	// jest-console setup turns those into failures).
	mockedApiFetch.mockImplementation(
		() => new Promise< unknown >( () => {} )
	);
} );

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
		// First-time URL submit (no previous resource) — token is cleared
		// because the previous-vs-next resource comparison treats a
		// missing previous URL as a resource change.
		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/activities/123',
			stravaEmbedToken: '',
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
			stravaEmbedToken: '',
		} );
	} );

	it( 'clears a stale stravaEmbedToken when the URL points to a different resource', async () => {
		// Tokens are per-resource. Without this clear, editing the URL on
		// an existing block to point at a different activity would leave
		// the old activity's token attached to the new iframe URL — and
		// the preflight would be skipped (the stored token short-circuits
		// to `embedStatus === 'ok'`), suppressing the "needs token"
		// notice for an iframe that's actually broken.
		const setAttributes = jest.fn();
		render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
					stravaEmbedToken: 'old-token-from-previous-activity',
				},
				setAttributes,
			} )
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /edit url/i } )
		);
		const input = screen.getByRole( 'textbox', { name: /embed url/i } );
		await userEvent.clear( input );
		await userEvent.type( input, 'https://www.strava.com/activities/999' );
		await userEvent.click(
			screen.getByRole( 'button', { name: /^embed$/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/activities/999',
			stravaEmbedToken: '',
		} );
	} );

	it( 'preserves the token when the resubmitted URL resolves to the same resource', async () => {
		// A user fixing a typo or adding a tracking query param to the
		// same activity URL shouldn't lose a working token. The
		// `previousResolved == nextResolved` check in submitURL keeps
		// the token attached when the canonical {type,id} is unchanged.
		const setAttributes = jest.fn();
		render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
					stravaEmbedToken: 'still-valid-token',
				},
				setAttributes,
			} )
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /edit url/i } )
		);
		const input = screen.getByRole( 'textbox', { name: /embed url/i } );
		await userEvent.clear( input );
		// Same /activities/123, but with a tracking query param appended.
		await userEvent.type(
			input,
			'https://www.strava.com/activities/123?utm_source=newsletter'
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /^embed$/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/activities/123?utm_source=newsletter',
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

	it( 'renders an editable caption and forwards typed text via setAttributes', async () => {
		const setAttributes = jest.fn();
		render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
					caption: 'Initial text',
				},
				setAttributes,
			} )
		);
		const caption = screen.getByLabelText(
			/strava embed caption/i
		) as HTMLElement;
		expect( caption ).toBeInTheDocument();
		expect( caption.tagName.toLowerCase() ).toBe( 'figcaption' );
		await userEvent.type( caption, 'X' );
		expect( setAttributes ).toHaveBeenCalledWith(
			expect.objectContaining( { caption: expect.any( String ) } )
		);
	} );

	it( 'hides the caption by default and reveals it when the toolbar Add caption is clicked', async () => {
		render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.queryByLabelText( /strava embed caption/i ) ).toBeNull();
		await userEvent.click(
			screen.getByRole( 'button', { name: /add caption/i } )
		);
		expect(
			screen.getByLabelText( /strava embed caption/i )
		).toBeInTheDocument();
	} );

	it( 'clears the caption attribute when the toolbar Remove caption is clicked', async () => {
		/*
		 * Toggling off must wipe the attribute — otherwise the PHP renderer
		 * still emits `<figcaption>` on the published page even though the
		 * editor hides the field.
		 */
		const setAttributes = jest.fn();
		render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
					caption: 'My morning ride',
				},
				setAttributes,
			} )
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /remove caption/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( { caption: '' } );
		expect( screen.queryByLabelText( /strava embed caption/i ) ).toBeNull();
	} );

	it( 'omits the caption toolbar button while the URL is being edited', async () => {
		render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect(
			screen.queryByRole( 'button', { name: /add caption/i } )
		).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole( 'button', { name: /edit url/i } )
		);
		expect(
			screen.queryByRole( 'button', { name: /add caption/i } )
		).toBeNull();
	} );

	it( 'defaults the caption toggle off when the attribute is empty', () => {
		render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
					caption: '',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.queryByLabelText( /strava embed caption/i ) ).toBeNull();
	} );

	it( 'defaults the caption toggle on when transferred content is present', () => {
		/*
		 * `core/embed → strava` transforms preserve `caption` via
		 * `embed-transform.ts`. Without the lazy-init from the attribute,
		 * the transferred text would render on the front end while the
		 * editor field stayed hidden.
		 */
		render(
			createElement( Edit, {
				attributes: {
					url: 'https://www.strava.com/activities/123',
					caption: 'My morning ride',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect(
			screen.getByLabelText( /strava embed caption/i )
		).toBeInTheDocument();
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

	describe( 'token threading', () => {
		it( 'appends ?token=… to the iframe src for activity URLs with a stored token', () => {
			const { container } = render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
						stravaEmbedToken: 'abc-XYZ_42',
					},
					setAttributes: jest.fn(),
				} )
			);
			const iframe = container.querySelector(
				'iframe.strava-embed-iframe'
			);
			expect( iframe?.getAttribute( 'src' ) ).toBe(
				'https://strava-embeds.com/activity/123?token=abc-XYZ_42'
			);
		} );

		it( 'skips the preflight call when a token is already stored', () => {
			render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
						stravaEmbedToken: 'abc',
					},
					setAttributes: jest.fn(),
				} )
			);
			expect( mockedApiFetch ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'URL preflight', () => {
		it( 'calls the REST endpoint with the resolved type+id when no token is stored', () => {
			render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			expect( mockedApiFetch ).toHaveBeenCalledWith( {
				path: '/block-for-strava/v1/embed-status?type=activity&id=123',
			} );
		} );

		it( 'shows the snippet notice when the activity URL preflight returns 403', async () => {
			mockedApiFetch.mockResolvedValueOnce( {
				embeddable: false,
				status: 403,
			} );
			render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			await waitFor( () =>
				expect(
					screen.getByTestId( 'strava-embed-notice' )
				).toBeInTheDocument()
			);
		} );

		it( 'skips the preflight entirely for routes and segments', () => {
			// Routes/segments don't have a per-resource share token; even
			// if Strava 403'd a route URL, the "paste the share-dialog
			// snippet" advice wouldn't help. Avoid the wasted REST call
			// (and the corresponding remote HEAD) by gating the preflight
			// to activities.
			render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/routes/456',
					},
					setAttributes: jest.fn(),
				} )
			);
			expect( mockedApiFetch ).not.toHaveBeenCalled();
			expect( screen.queryByTestId( 'strava-embed-notice' ) ).toBeNull();
		} );

		it( 'suppresses the notice on transport failure (status: 0)', async () => {
			mockedApiFetch.mockRejectedValueOnce( new Error( 'network down' ) );
			render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			await act( async () => {} );
			expect( screen.queryByTestId( 'strava-embed-notice' ) ).toBeNull();
		} );

		it( 'does not surface the notice for 200 OK preflight responses', async () => {
			mockedApiFetch.mockResolvedValueOnce( {
				embeddable: true,
				status: 200,
			} );
			render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			await act( async () => {} );
			expect( screen.queryByTestId( 'strava-embed-notice' ) ).toBeNull();
		} );

		it( 'ignores a stale preflight 403 after the URL changed mid-flight', async () => {
			/*
			 * The effect cleanup flips a `cancelled` flag so a still-pending
			 * apiFetch from a prior URL cannot overwrite the new URL's
			 * preflight state. Without that guard, the stale 403 from
			 * activity 123 would race in after the user pasted activity 456
			 * and pop the snippet notice for the wrong resource.
			 */
			let resolveStale: ( value: {
				embeddable: boolean;
				status: number;
			} ) => void = () => {};
			mockedApiFetch.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						resolveStale = resolve;
					} )
			);
			mockedApiFetch.mockResolvedValueOnce( {
				embeddable: true,
				status: 200,
			} );
			const { rerender } = render(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/123',
					},
					setAttributes: jest.fn(),
				} )
			);
			rerender(
				createElement( Edit, {
					attributes: {
						url: 'https://www.strava.com/activities/456',
					},
					setAttributes: jest.fn(),
				} )
			);
			await act( async () => {
				resolveStale( { embeddable: false, status: 403 } );
			} );
			/*
			 * Pin that the rerender actually started a fresh preflight for
			 * activity 456 — otherwise this test could silently pass if the
			 * URL-change effect stopped re-firing (notice would remain null
			 * for the wrong reason).
			 */
			expect( mockedApiFetch ).toHaveBeenCalledWith( {
				path: '/block-for-strava/v1/embed-status?type=activity&id=456',
			} );
			expect( screen.queryByTestId( 'strava-embed-notice' ) ).toBeNull();
		} );
	} );
} );

describe( 'parseStravaUrl', () => {
	it.each( [
		[
			'canonical activity URL',
			'https://www.strava.com/activities/123',
			{ type: 'activity', id: '123' },
		],
		[
			'canonical route URL',
			'https://www.strava.com/routes/456',
			{ type: 'route', id: '456' },
		],
		[
			'canonical segment URL',
			'https://www.strava.com/segments/789',
			{ type: 'segment', id: '789' },
		],
		[
			'subdomain + trailing path segment',
			'https://app.strava.com/activities/123/overview',
			{ type: 'activity', id: '123' },
		],
	] )( 'parses %s', ( _label, input, expected ) => {
		expect( parseStravaUrl( input ) ).toEqual( expected );
	} );

	it.each( [
		[ 'non-Strava host', 'https://example.com/activities/123' ],
		[ 'unsupported path (clubs)', 'https://www.strava.com/clubs/123' ],
		[ 'short URL form', 'https://strava.app.link/abc' ],
		/*
		 * Without the `(?=[/?#]|$)` guard, /activities/123abc would
		 * silently match as activity 123 and we'd embed the wrong
		 * resource.
		 */
		[
			'ID-with-suffix lookalike (boundary check)',
			'https://www.strava.com/activities/123abc',
		],
	] )( 'rejects %s', ( _label, input ) => {
		expect( parseStravaUrl( input ) ).toBeNull();
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

	it( 'appends ?token=… for activities and segments at defaults', () => {
		expect(
			buildEmbedUrl(
				{ type: 'activity', id: '123' },
				{ stravaEmbedToken: 'abc-XYZ_42' }
			)
		).toBe( 'https://strava-embeds.com/activity/123?token=abc-XYZ_42' );
		expect(
			buildEmbedUrl(
				{ type: 'segment', id: '789' },
				{ stravaEmbedToken: 'tkn' }
			)
		).toBe( 'https://strava-embeds.com/segment/789?token=tkn' );
	} );

	it( 'URL-encodes a token containing reserved characters', () => {
		expect(
			buildEmbedUrl(
				{ type: 'activity', id: '123' },
				{ stravaEmbedToken: 'a&b=c d' }
			)
		).toBe( 'https://strava-embeds.com/activity/123?token=a%26b%3Dc%20d' );
	} );

	it( 'appends ?token=… on routes at defaults (no other params)', () => {
		expect(
			buildEmbedUrl(
				{ type: 'route', id: '456' },
				{ stravaEmbedToken: 'tkn' }
			)
		).toBe( 'https://strava-embeds.com/route/456?token=tkn' );
	} );

	it( 'merges token alongside non-default route params', () => {
		const url = new URL(
			buildEmbedUrl(
				{ type: 'route', id: '456' },
				{
					stravaRouteTerrain: '3d',
					stravaEmbedToken: 'tkn',
				}
			)
		);
		expect( url.searchParams.get( 'style' ) ).toBe( 'standard' );
		expect( url.searchParams.get( 'terrain' ) ).toBe( '3d' );
		expect( url.searchParams.get( 'token' ) ).toBe( 'tkn' );
	} );

	it( 'ignores non-string stored tokens', () => {
		// Hand-edited block markup can persist arbitrary types. The clamp
		// in `buildEmbedUrl` mirrors the preflight effect in `Edit` so
		// neither side trusts a non-string `stravaEmbedToken`.
		expect(
			buildEmbedUrl(
				{ type: 'activity', id: '123' },
				{ stravaEmbedToken: 0 as unknown as string }
			)
		).toBe( 'https://strava-embeds.com/activity/123' );
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

	it( 'clamps a negative finite height up to the floor', () => {
		/*
		 * A negative finite value passes the `Number.isFinite` gate, so
		 * the implementation clamps it up to MIN_PREVIEW_HEIGHT rather
		 * than rejecting. Pin the current behavior so a future "tighten
		 * the gate" pass surfaces the change instead of silently flipping
		 * to null.
		 */
		expect(
			parseStravaHeightMessage( [ 0, 'BROADCAST_IFRAME_HEIGHT', -5 ] )
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
