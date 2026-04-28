import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiFetch from '@wordpress/api-fetch';
import Edit from '../../src/edit';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

const mockedApiFetch = jest.mocked( apiFetch );

function getIframe( container: HTMLElement ): HTMLIFrameElement {
	const iframe = container.querySelector( 'iframe' );
	expect( iframe ).toBeInTheDocument();
	return iframe as HTMLIFrameElement;
}

function extractEmbedId( iframe: HTMLIFrameElement ): string {
	const srcDoc = iframe.getAttribute( 'srcdoc' ) ?? '';
	const idMatch = srcDoc.match( /var n="([^"]+)"/ );
	expect( idMatch ).not.toBeNull();
	return idMatch![ 1 ];
}

type EmbedType = 'activity' | 'route' | 'segment';
type RouteUnits = 'auto' | 'metric' | 'imperial';
type RouteMapStyle =
	| 'standard'
	| 'satellite'
	| 'hybrid'
	| 'dark'
	| 'winter'
	| 'light';
type RouteTerrain = 'auto' | '2d' | '3d';

interface RenderEditOptions {
	activityId?: string;
	embedType?: EmbedType;
	caption?: string;
	url?: string;
	isSelected?: boolean;
	routeShowElevation?: boolean;
	routeUnits?: RouteUnits;
	routeFullWidth?: boolean;
	routeMapStyle?: RouteMapStyle;
	routeTerrain?: RouteTerrain;
	routeShowDirt?: boolean;
}

function buildAttributes( options: RenderEditOptions = {} ) {
	return {
		url: options.url ?? '',
		activityId: options.activityId ?? '',
		embedType: options.embedType ?? ( 'activity' as EmbedType ),
		caption: options.caption ?? '',
		routeShowElevation: options.routeShowElevation ?? true,
		routeUnits: options.routeUnits ?? ( 'auto' as RouteUnits ),
		routeFullWidth: options.routeFullWidth ?? false,
		routeMapStyle: options.routeMapStyle ?? ( 'standard' as RouteMapStyle ),
		routeTerrain: options.routeTerrain ?? ( 'auto' as RouteTerrain ),
		routeShowDirt: options.routeShowDirt ?? false,
	};
}

function renderEdit( options: RenderEditOptions = {} ) {
	const setAttributes = jest.fn();
	const attributes = buildAttributes( options );
	const utils = render(
		<Edit
			attributes={ attributes }
			setAttributes={ setAttributes }
			isSelected={ options.isSelected ?? false }
		/>
	);
	return { ...utils, setAttributes, attributes };
}

beforeEach( () => {
	mockedApiFetch.mockReset();
} );

describe( 'Edit – placeholder (editing) mode', () => {
	it( 'renders the placeholder when no activity is set', () => {
		renderEdit();
		expect( screen.getByTestId( 'placeholder' ) ).toBeInTheDocument();
		expect(
			screen.getByPlaceholderText( 'https://www.strava.com/activities/…' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Embed' } )
		).toBeInTheDocument();
	} );

	it( 'shows an error when submitting an empty URL', async () => {
		const user = userEvent.setup();
		renderEdit();
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );
		const alert = await screen.findByRole( 'alert' );
		expect( alert ).toHaveTextContent( 'Please enter a URL.' );
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'shows an error when the URL is not a Strava URL', async () => {
		const user = userEvent.setup();
		renderEdit();
		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://example.com/some-page'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );
		expect(
			await screen.findByText(
				/valid Strava activity, route, or segment URL/i
			)
		).toBeInTheDocument();
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'parses an embed snippet without calling the REST endpoint', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();
		const snippet =
			'<div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="123456789" data-style="standard"></div>';

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			snippet
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect( setAttributes ).toHaveBeenCalledWith( {
			url: snippet,
			activityId: '123456789',
			embedType: 'activity',
		} );
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'parses a route embed snippet and stores embedType=route', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();
		const snippet =
			'<div class="strava-embed-placeholder" data-embed-type="route" data-embed-id="555"></div>';

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			snippet
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect( setAttributes ).toHaveBeenCalledWith( {
			url: snippet,
			activityId: '555',
			embedType: 'route',
		} );
	} );

	it( 'defaults to embedType=activity when the snippet has no data-embed-type', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();
		const snippet =
			'<div class="strava-embed-placeholder" data-embed-id="987654321"></div>';

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			snippet
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect( setAttributes ).toHaveBeenCalledWith( {
			url: snippet,
			activityId: '987654321',
			embedType: 'activity',
		} );
	} );

	it( 'parses a canonical activity URL locally without calling the REST endpoint', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://www.strava.com/activities/111'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/activities/111',
			activityId: '111',
			embedType: 'activity',
		} );
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'parses a canonical route URL locally with embedType=route', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://www.strava.com/routes/777'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/routes/777',
			activityId: '777',
			embedType: 'route',
		} );
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'parses a canonical segment URL locally with embedType=segment', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://www.strava.com/segments/888'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/segments/888',
			activityId: '888',
			embedType: 'segment',
		} );
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'rejects look-alike hosts like evilstrava.com', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://evilstrava.com/activities/111'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect(
			await screen.findByText(
				/valid Strava activity, route, or segment URL/i
			)
		).toBeInTheDocument();
		expect( setAttributes ).not.toHaveBeenCalled();
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'rejects unparseable URLs', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'not a url'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect(
			await screen.findByText(
				/valid Strava activity, route, or segment URL/i
			)
		).toBeInTheDocument();
		expect( setAttributes ).not.toHaveBeenCalled();
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'rejects strava.com URLs whose path is not an activity, route, or segment', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://www.strava.com/blog/some-post'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect(
			await screen.findByText(
				/valid Strava activity, route, or segment URL/i
			)
		).toBeInTheDocument();
		expect( setAttributes ).not.toHaveBeenCalled();
		expect( mockedApiFetch ).not.toHaveBeenCalled();
	} );

	it( 'resolves a short strava.app.link URL via apiFetch and falls back to embedType=activity', async () => {
		const user = userEvent.setup();
		mockedApiFetch.mockResolvedValueOnce( { activityId: '222' } );
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://strava.app.link/abcd'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		await waitFor( () => {
			expect( setAttributes ).toHaveBeenCalledWith( {
				url: 'https://strava.app.link/abcd',
				activityId: '222',
				embedType: 'activity',
			} );
		} );
	} );

	it( 'shows an Error instance message when the REST request fails', async () => {
		const user = userEvent.setup();
		mockedApiFetch.mockRejectedValueOnce(
			new Error( 'Activity not found' )
		);
		renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://strava.app.link/xyz'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect(
			await screen.findByText( 'Activity not found' )
		).toBeInTheDocument();
	} );

	it( 'falls back to a generic error string when the rejection is not an Error', async () => {
		const user = userEvent.setup();
		mockedApiFetch.mockRejectedValueOnce( 'boom' );
		renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://strava.app.link/abc'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect(
			await screen.findByText( 'Could not resolve URL.' )
		).toBeInTheDocument();
	} );

	it( 'shows a loading spinner while apiFetch is in flight', async () => {
		const user = userEvent.setup();
		let resolve!: ( value: {
			activityId: string;
			embedType?: EmbedType;
		} ) => void;
		mockedApiFetch.mockImplementationOnce(
			() =>
				new Promise( ( res ) => {
					resolve = res;
				} )
		);
		renderEdit();

		await user.type(
			screen.getByPlaceholderText(
				'https://www.strava.com/activities/…'
			),
			'https://strava.app.link/spin'
		);
		await user.click( screen.getByRole( 'button', { name: 'Embed' } ) );

		expect( screen.getByTestId( 'spinner' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Embed' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByTestId( 'placeholder' ).querySelector( 'form' )
		).toHaveAttribute( 'aria-busy', 'true' );

		await act( async () => {
			resolve( { activityId: '444', embedType: 'activity' } );
		} );
		await waitFor( () => {
			expect( screen.queryByTestId( 'spinner' ) ).not.toBeInTheDocument();
		} );
	} );
} );

describe( 'Edit – preview (rendered) mode', () => {
	it( 'renders a sandboxed iframe with the embed snippet for the activity', () => {
		const { container } = renderEdit( { activityId: '42' } );
		const iframe = getIframe( container );
		expect( iframe.getAttribute( 'sandbox' ) ).toBe( 'allow-scripts' );
		const srcDoc = iframe.getAttribute( 'srcdoc' ) ?? '';
		expect( srcDoc ).toContain( 'data-embed-id="42"' );
	} );

	it( 'wires the BROADCAST_IFRAME_HEIGHT relay and default-height fallback into the srcdoc', () => {
		const { container } = renderEdit( { activityId: '42' } );
		const srcDoc = getIframe( container ).getAttribute( 'srcdoc' ) ?? '';
		/*
		 * If these literals drift, Strava's embed.js never sees the relay and
		 * the editor preview never resizes — but no other unit test would
		 * notice. The DEFAULT_HEIGHT (730) is the fallback the relay sends
		 * when the embed reports no explicit height.
		 */
		expect( srcDoc ).toContain( 'BROADCAST_IFRAME_HEIGHT' );
		expect( srcDoc ).toContain( '||730' );
	} );

	it( 'reflects the saved embedType in the srcdoc data-embed-type attribute', () => {
		const { container } = renderEdit( {
			activityId: '42',
			embedType: 'route',
		} );
		const srcDoc = getIframe( container ).getAttribute( 'srcdoc' ) ?? '';
		expect( srcDoc ).toContain( 'data-embed-type="route"' );
	} );

	it( 'clamps an unknown embedType to "activity" before interpolating into the srcdoc', () => {
		/*
		 * block.json declares an enum for embedType, but a hand-edited post
		 * could persist anything; the iframe is sandboxed so this is defense
		 * in depth, not the primary boundary.
		 */
		const { container } = renderEdit( {
			activityId: '42',
			embedType: 'bogus' as 'activity',
		} );
		const srcDoc = getIframe( container ).getAttribute( 'srcdoc' ) ?? '';
		expect( srcDoc ).toContain( 'data-embed-type="activity"' );
		expect( srcDoc ).not.toContain( 'data-embed-type="bogus"' );
	} );

	it( 'drops a non-numeric activityId from the srcdoc data-embed-id attribute', () => {
		const { container } = renderEdit( {
			activityId: '"><script>alert(1)</script>',
		} );
		const srcDoc = getIframe( container ).getAttribute( 'srcdoc' ) ?? '';
		expect( srcDoc ).toContain( 'data-embed-id=""' );
		expect( srcDoc ).not.toContain( '<script>alert(1)</script>"' );
	} );

	it( 'regenerates the embedId when embedType changes for the same activityId', () => {
		const setAttributes = jest.fn();
		const { container, rerender } = render(
			<Edit
				attributes={ buildAttributes( {
					activityId: '42',
					embedType: 'activity',
				} ) }
				setAttributes={ setAttributes }
				isSelected={ false }
			/>
		);
		const firstId = extractEmbedId( getIframe( container ) );

		rerender(
			<Edit
				attributes={ buildAttributes( {
					activityId: '42',
					embedType: 'route',
				} ) }
				setAttributes={ setAttributes }
				isSelected={ false }
			/>
		);
		const secondId = extractEmbedId( getIframe( container ) );

		expect( secondId ).not.toBe( firstId );
	} );

	it( 'renders the caption RichText only when the block is selected or the caption has content', () => {
		const unselectedNoCaption = renderEdit( { activityId: '42' } );
		expect(
			unselectedNoCaption.queryByTestId( 'rich-text' )
		).not.toBeInTheDocument();
		unselectedNoCaption.unmount();

		const selectedNoCaption = renderEdit( {
			activityId: '42',
			isSelected: true,
		} );
		expect(
			selectedNoCaption.getByTestId( 'rich-text' )
		).toBeInTheDocument();
		selectedNoCaption.unmount();

		const unselectedWithCaption = renderEdit( {
			activityId: '42',
			caption: 'Morning ride',
		} );
		expect(
			unselectedWithCaption.getByTestId( 'rich-text' )
		).toBeInTheDocument();
	} );

	it( 'updates the caption attribute when the RichText fires onChange', () => {
		const { setAttributes } = renderEdit( {
			activityId: '42',
			isSelected: true,
		} );
		const rich = screen.getByTestId( 'rich-text' );
		// Simulate an input event with the new text content.
		rich.textContent = 'Updated caption';
		fireEvent.input( rich );
		expect( setAttributes ).toHaveBeenCalledWith( {
			caption: 'Updated caption',
		} );
	} );

	it( 'labels the caption RichText for assistive technology', () => {
		renderEdit( { activityId: '42', isSelected: true } );
		expect( screen.getByTestId( 'rich-text' ) ).toHaveAttribute(
			'aria-label',
			'Strava activity caption text'
		);
	} );

	it( 'focuses the empty caption when it appears so the user can type', () => {
		renderEdit( { activityId: '42', isSelected: true } );
		expect( screen.getByTestId( 'rich-text' ) ).toHaveFocus();
	} );

	it( 'does not steal focus when a caption already has content', () => {
		renderEdit( {
			activityId: '42',
			isSelected: true,
			caption: 'Morning ride',
		} );
		expect( screen.getByTestId( 'rich-text' ) ).not.toHaveFocus();
	} );

	it( 'switches back to editing mode when the Replace toolbar button is clicked', async () => {
		const user = userEvent.setup();
		const { container } = renderEdit( { activityId: '42' } );
		expect( getIframe( container ) ).toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Replace' } ) );
		expect( screen.getByTestId( 'placeholder' ) ).toBeInTheDocument();
	} );

	describe( 'postMessage height relay', () => {
		function dispatchMessage( source: Window | null, data: unknown ): void {
			act( () => {
				window.dispatchEvent(
					new MessageEvent( 'message', {
						data,
						source: source as MessageEventSource | null,
					} )
				);
			} );
		}

		it( 'ignores messages from other windows', () => {
			const { container } = renderEdit( { activityId: '42' } );
			const iframe = getIframe( container );
			const initialHeight = iframe.style.height;

			dispatchMessage( window, {
				stravaEmbedId: 'whatever',
				stravaEmbedHeight: 1234,
			} );

			expect( iframe.style.height ).toBe( initialHeight );
		} );

		it( 'ignores messages with falsy data', () => {
			const { container } = renderEdit( { activityId: '42' } );
			const iframe = getIframe( container );
			const before = iframe.style.height;
			dispatchMessage( iframe.contentWindow, null );
			expect( iframe.style.height ).toBe( before );
		} );

		it( 'ignores messages whose payload is not an object', () => {
			const { container } = renderEdit( { activityId: '42' } );
			const iframe = getIframe( container );
			const before = iframe.style.height;
			dispatchMessage( iframe.contentWindow, 'not-an-object' );
			expect( iframe.style.height ).toBe( before );
		} );

		it( 'ignores messages from this iframe with a mismatched embed id', () => {
			const { container } = renderEdit( { activityId: '42' } );
			const iframe = getIframe( container );
			const before = iframe.style.height;
			dispatchMessage( iframe.contentWindow, {
				stravaEmbedId: 'mismatched',
				stravaEmbedHeight: 900,
			} );
			expect( iframe.style.height ).toBe( before );
		} );

		it( 'ignores messages whose height is not finite', () => {
			const { container } = renderEdit( { activityId: '42' } );
			const iframe = getIframe( container );
			const before = iframe.style.height;
			/* Use the real embedId so the non-finite check is the only branch left to fail. */
			dispatchMessage( iframe.contentWindow, {
				stravaEmbedId: extractEmbedId( iframe ),
				stravaEmbedHeight: 'tall',
			} );
			expect( iframe.style.height ).toBe( before );
		} );

		it( 'sets the iframe height when a valid relay message arrives', () => {
			const { container } = renderEdit( { activityId: '42' } );
			const iframe = getIframe( container );
			const embedId = extractEmbedId( iframe );

			dispatchMessage( iframe.contentWindow, {
				stravaEmbedId: embedId,
				stravaEmbedHeight: 850,
			} );

			expect( iframe.style.height ).toBe( '850px' );
		} );

		it( 'clamps heights below the minimum to the floor', () => {
			const { container } = renderEdit( { activityId: '42' } );
			const iframe = getIframe( container );
			const embedId = extractEmbedId( iframe );

			dispatchMessage( iframe.contentWindow, {
				stravaEmbedId: embedId,
				stravaEmbedHeight: 50,
			} );

			expect( iframe.style.height ).toBe( '100px' );
		} );

		it( 'clamps heights above the maximum to the ceiling', () => {
			const { container } = renderEdit( { activityId: '42' } );
			const iframe = getIframe( container );
			const embedId = extractEmbedId( iframe );

			dispatchMessage( iframe.contentWindow, {
				stravaEmbedId: embedId,
				stravaEmbedHeight: 99999,
			} );

			expect( iframe.style.height ).toBe( '5000px' );
		} );

		it( 'resets the height to the default when the activity changes', () => {
			const setAttributes = jest.fn();
			const { container, rerender } = render(
				<Edit
					attributes={ buildAttributes( {
						activityId: '42',
						embedType: 'activity',
					} ) }
					setAttributes={ setAttributes }
					isSelected={ false }
				/>
			);
			const iframe = getIframe( container );
			const embedId = extractEmbedId( iframe );

			dispatchMessage( iframe.contentWindow, {
				stravaEmbedId: embedId,
				stravaEmbedHeight: 850,
			} );
			expect( iframe.style.height ).toBe( '850px' );

			rerender(
				<Edit
					attributes={ buildAttributes( {
						activityId: '99',
						embedType: 'activity',
					} ) }
					setAttributes={ setAttributes }
					isSelected={ false }
				/>
			);

			expect( getIframe( container ).style.height ).toBe( '730px' );
		} );
	} );
} );

describe( 'Edit – embedId generation', () => {
	const realCrypto = globalThis.crypto;

	afterEach( () => {
		Object.defineProperty( globalThis, 'crypto', {
			configurable: true,
			value: realCrypto,
		} );
	} );

	it( 'uses crypto.randomUUID when the API is available', () => {
		const uuid = '00000000-0000-4000-8000-000000000000';
		Object.defineProperty( globalThis, 'crypto', {
			configurable: true,
			value: { randomUUID: () => uuid },
		} );

		const { container } = renderEdit( { activityId: '42' } );
		const srcDoc =
			container.querySelector( 'iframe' )?.getAttribute( 'srcdoc' ) ?? '';
		expect( srcDoc ).toContain( `var n="${ uuid }"` );
	} );

	it( 'falls back to a random string id when crypto is unavailable', () => {
		Object.defineProperty( globalThis, 'crypto', {
			configurable: true,
			value: undefined,
		} );

		const { container } = renderEdit( { activityId: '42' } );
		const srcDoc =
			container.querySelector( 'iframe' )?.getAttribute( 'srcdoc' ) ?? '';
		expect( srcDoc ).toMatch( /var n="bfs-[a-z0-9]+-[a-z0-9]+"/ );
	} );

	it( 'falls back when crypto exists but lacks randomUUID', () => {
		Object.defineProperty( globalThis, 'crypto', {
			configurable: true,
			value: {},
		} );

		const { container } = renderEdit( { activityId: '42' } );
		const srcDoc =
			container.querySelector( 'iframe' )?.getAttribute( 'srcdoc' ) ?? '';
		expect( srcDoc ).toMatch( /var n="bfs-/ );
	} );
} );

describe( 'Edit – route options sidebar', () => {
	it( 'does not render the Route options panel for activity embeds', () => {
		renderEdit( { activityId: '42', embedType: 'activity' } );
		expect(
			screen.queryByTestId( 'inspector-controls' )
		).not.toBeInTheDocument();
	} );

	it( 'does not render the Route options panel for segment embeds', () => {
		renderEdit( { activityId: '42', embedType: 'segment' } );
		expect(
			screen.queryByTestId( 'inspector-controls' )
		).not.toBeInTheDocument();
	} );

	it( 'renders the Route options panel only after a route is embedded', () => {
		renderEdit( { activityId: '42', embedType: 'route' } );
		expect(
			screen.getByTestId( 'inspector-controls' )
		).toBeInTheDocument();
	} );

	it( 'hides the Route options panel while still in editing mode', () => {
		renderEdit( { embedType: 'route' } );
		expect(
			screen.queryByTestId( 'inspector-controls' )
		).not.toBeInTheDocument();
	} );

	it( 'toggles routeShowElevation when the elevation switch is clicked', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit( {
			activityId: '42',
			embedType: 'route',
		} );
		await user.click(
			screen.getByRole( 'switch', { name: 'Show elevation profile' } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			routeShowElevation: false,
		} );
	} );

	it( 'updates routeUnits when a metric radio is selected', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit( {
			activityId: '42',
			embedType: 'route',
		} );
		await user.click(
			screen.getByRole( 'radio', { name: 'Units: Metric' } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			routeUnits: 'metric',
		} );
	} );

	it( 'flips routeFullWidth when the embed-width radio toggles to responsive', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit( {
			activityId: '42',
			embedType: 'route',
		} );
		await user.click(
			screen.getByRole( 'radio', { name: 'Embed width: Responsive' } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			routeFullWidth: true,
		} );
	} );

	it( 'updates routeMapStyle when a new map style is chosen', () => {
		const { setAttributes } = renderEdit( {
			activityId: '42',
			embedType: 'route',
		} );
		fireEvent.change(
			screen.getByRole( 'combobox', { name: 'Map style' } ),
			{
				target: { value: 'satellite' },
			}
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			routeMapStyle: 'satellite',
		} );
	} );

	it( 'updates routeTerrain when a new terrain radio is selected', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit( {
			activityId: '42',
			embedType: 'route',
		} );
		await user.click(
			screen.getByRole( 'radio', { name: 'Terrain: 3D' } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( { routeTerrain: '3d' } );
	} );

	it( 'toggles routeShowDirt when the unpaved-surfaces switch is clicked', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit( {
			activityId: '42',
			embedType: 'route',
		} );
		await user.click(
			screen.getByRole( 'switch', { name: 'Highlight unpaved surfaces' } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( { routeShowDirt: true } );
	} );

	it( 'shows the clamped fallback in the sidebar when a persisted enum is invalid', () => {
		/*
		 * Without sharing the clamp, a hand-edited post with an invalid enum
		 * would render the sidebar with no option selected even though the
		 * preview/front-end fell back to a sane default.
		 */
		renderEdit( {
			activityId: '42',
			embedType: 'route',
			routeUnits: 'furlongs' as RouteUnits,
			routeMapStyle: 'parchment' as RouteMapStyle,
			routeTerrain: '4d' as RouteTerrain,
		} );
		expect(
			screen.getByRole( 'radio', { name: 'Units: Auto' } )
		).toBeChecked();
		expect(
			screen.getByRole( 'combobox', { name: 'Map style' } )
		).toHaveValue( 'standard' );
		expect(
			screen.getByRole( 'radio', { name: 'Terrain: Auto' } )
		).toBeChecked();
	} );

	it( 'shows the clamped boolean fallback in the sidebar when a persisted bool is a string', () => {
		/*
		 * Hand-edited block comments can persist bools as strings. `if ("false")`
		 * is truthy in JS, so without strict-type clamping the sidebar would show
		 * one state while the preview/front-end emitted the wrong attributes.
		 */
		renderEdit( {
			activityId: '42',
			embedType: 'route',
			routeShowElevation: 'false' as unknown as boolean,
			routeFullWidth: 'false' as unknown as boolean,
			routeShowDirt: 'true' as unknown as boolean,
		} );
		expect(
			screen.getByRole( 'switch', { name: 'Show elevation profile' } )
		).toBeChecked();
		expect(
			screen.getByRole( 'radio', { name: 'Embed width: Fixed' } )
		).toBeChecked();
		expect(
			screen.getByRole( 'switch', { name: 'Highlight unpaved surfaces' } )
		).not.toBeChecked();
	} );
} );

describe( 'Edit – route options srcdoc serialization', () => {
	function srcDoc( options: RenderEditOptions ): string {
		const { container } = renderEdit( {
			activityId: '42',
			embedType: 'route',
			...options,
		} );
		const doc =
			container.querySelector( 'iframe' )?.getAttribute( 'srcdoc' ) ?? '';
		// Each test re-renders, but jsdom keeps the previous nodes alive until
		// teardown — the iframe we want is the one rendered from this call.
		return doc;
	}

	it( 'emits only the chosen map style at defaults (no extra data-* attrs)', () => {
		const doc = srcDoc( {} );
		expect( doc ).toContain( 'data-style="standard"' );
		expect( doc ).not.toContain( 'data-hide-elevation' );
		expect( doc ).not.toContain( 'data-units' );
		expect( doc ).not.toContain( 'data-full-width' );
		expect( doc ).not.toContain( 'data-terrain' );
		expect( doc ).not.toContain( 'data-surface-type' );
	} );

	it( 'adds data-hide-elevation only when the user disables the elevation profile', () => {
		expect( srcDoc( { routeShowElevation: false } ) ).toContain(
			'data-hide-elevation="true"'
		);
	} );

	it( 'omits data-units when on auto and includes it for metric/imperial', () => {
		expect( srcDoc( { routeUnits: 'auto' } ) ).not.toContain(
			'data-units'
		);
		expect( srcDoc( { routeUnits: 'metric' } ) ).toContain(
			'data-units="metric"'
		);
		expect( srcDoc( { routeUnits: 'imperial' } ) ).toContain(
			'data-units="imperial"'
		);
	} );

	it( 'adds data-full-width only when the embed is set to responsive', () => {
		expect( srcDoc( { routeFullWidth: true } ) ).toContain(
			'data-full-width="true"'
		);
	} );

	it( 'reflects the chosen map style in data-style', () => {
		expect( srcDoc( { routeMapStyle: 'dark' } ) ).toContain(
			'data-style="dark"'
		);
	} );

	it( 'omits data-terrain on auto and includes it for 2d/3d', () => {
		expect( srcDoc( { routeTerrain: 'auto' } ) ).not.toContain(
			'data-terrain'
		);
		expect( srcDoc( { routeTerrain: '2d' } ) ).toContain(
			'data-terrain="2d"'
		);
		expect( srcDoc( { routeTerrain: '3d' } ) ).toContain(
			'data-terrain="3d"'
		);
	} );

	it( 'adds data-surface-type only when unpaved highlighting is enabled', () => {
		expect( srcDoc( { routeShowDirt: true } ) ).toContain(
			'data-surface-type="true"'
		);
	} );

	it( 'falls back to data-style="standard" when the persisted route option is bogus', () => {
		const doc = srcDoc( {
			routeMapStyle: 'parchment' as RouteMapStyle,
			routeUnits: 'furlongs' as RouteUnits,
			routeTerrain: '4d' as RouteTerrain,
		} );
		expect( doc ).toContain( 'data-style="standard"' );
		expect( doc ).not.toContain( 'data-units' );
		expect( doc ).not.toContain( 'data-terrain' );
	} );

	it( 'treats string-valued booleans as the block.json defaults', () => {
		/*
		 * `if ("false")` is truthy in JS — without strict-type clamping these
		 * would silently invert the user's intent. Confirm the iframe uses the
		 * defaults when bools come through as strings.
		 */
		const doc = srcDoc( {
			routeShowElevation: 'false' as unknown as boolean,
			routeFullWidth: 'true' as unknown as boolean,
			routeShowDirt: 'true' as unknown as boolean,
		} );
		expect( doc ).not.toContain( 'data-hide-elevation' );
		expect( doc ).not.toContain( 'data-full-width' );
		expect( doc ).not.toContain( 'data-surface-type' );
	} );

	it( 'keeps data-style="standard" for activity embeds even with route options set', () => {
		const { container } = renderEdit( {
			activityId: '42',
			embedType: 'activity',
			routeMapStyle: 'satellite',
			routeFullWidth: true,
			routeShowDirt: true,
		} );
		const doc =
			container.querySelector( 'iframe' )?.getAttribute( 'srcdoc' ) ?? '';
		expect( doc ).toContain( 'data-style="standard"' );
		expect( doc ).not.toContain( 'data-style="satellite"' );
		expect( doc ).not.toContain( 'data-full-width' );
		expect( doc ).not.toContain( 'data-surface-type' );
	} );
} );
