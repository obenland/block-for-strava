/**
 * Verifies the route-customization filters wired into core/embed.
 *
 * Two surfaces to pin:
 * - The `blocks.registerBlockType` filter must add the route attributes to
 *   core/embed (and only core/embed); skipping that breaks every editor
 *   write for the Strava variation.
 * - The `editor.BlockEdit` filter must inject the inspector panel only
 *   when the variation is active and the URL is a route — adding it
 *   universally would clutter every embed block in the inserter.
 */
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, createElement, type ComponentType } from 'react';

import {
	buildEmbedUrl,
	parseStravaHeightMessage,
	StravaRouteInspector,
} from '../../src/route-controls';

interface AttributeSpec {
	type: 'string' | 'boolean';
	default?: unknown;
	enum?: ReadonlyArray< string >;
}

interface BlockTypeSettings {
	attributes?: Record< string, AttributeSpec >;
}

function applyRegisterFilter(
	settings: BlockTypeSettings,
	name: string
): BlockTypeSettings {
	return applyFilters(
		'blocks.registerBlockType',
		settings,
		name
	) as BlockTypeSettings;
}

interface EditProps {
	name: string;
	attributes: {
		providerNameSlug?: string;
		url?: string;
		stravaRouteMapStyle?: string;
		stravaRouteUnits?: string;
		stravaRouteTerrain?: string;
		stravaRouteFullWidth?: boolean;
		stravaRouteShowDirt?: boolean;
		stravaRouteShowElevation?: boolean;
		stravaEmbedToken?: string;
	};
	setAttributes: ( attrs: Partial< EditProps[ 'attributes' ] > ) => void;
}

function applyBlockEditFilter(
	BaseEdit: ComponentType< EditProps >
): ComponentType< EditProps > {
	return applyFilters(
		'editor.BlockEdit',
		BaseEdit
	) as ComponentType< EditProps >;
}

describe( 'route attribute injection', () => {
	it( 'adds route attributes to core/embed', () => {
		const result = applyRegisterFilter( {}, 'core/embed' );
		const attrs = result.attributes ?? {};
		expect( attrs.stravaRouteMapStyle ).toMatchObject( {
			type: 'string',
			default: 'standard',
		} );
		expect( attrs.stravaRouteTerrain ).toMatchObject( {
			type: 'string',
			default: 'auto',
		} );
		expect( attrs.stravaRouteUnits ).toMatchObject( {
			type: 'string',
			default: 'auto',
		} );
		expect( attrs.stravaRouteFullWidth ).toMatchObject( {
			type: 'boolean',
			default: false,
		} );
		expect( attrs.stravaRouteShowDirt ).toMatchObject( {
			type: 'boolean',
			default: false,
		} );
		expect( attrs.stravaRouteShowElevation ).toMatchObject( {
			type: 'boolean',
			default: true,
		} );
	} );

	it( 'preserves existing core/embed attributes', () => {
		const existing: Record< string, AttributeSpec > = {
			url: { type: 'string' },
			providerNameSlug: { type: 'string' },
		};
		const result = applyRegisterFilter(
			{ attributes: existing },
			'core/embed'
		);
		expect( result.attributes?.url ).toBe( existing.url );
		expect( result.attributes?.providerNameSlug ).toBe(
			existing.providerNameSlug
		);
	} );

	it( 'leaves other blocks untouched', () => {
		const settings: BlockTypeSettings = {
			attributes: { content: { type: 'string' } },
		};
		const result = applyRegisterFilter( settings, 'core/paragraph' );
		expect( result ).toBe( settings );
	} );
} );

describe( 'BlockEdit HOC', () => {
	function FakeEdit() {
		return createElement( 'div', { 'data-testid': 'fake-edit' }, 'fake' );
	}

	it( 'falls through to the underlying Edit for non-Strava embeds', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'youtube',
					url: 'https://www.youtube.com/watch?v=abc',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.getByTestId( 'fake-edit' ) ).toBeInTheDocument();
	} );

	it( 'renders our iframe (no inspector) for Strava activity URLs', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.queryByTestId( 'fake-edit' ) ).toBeNull();
		expect( screen.queryByTestId( 'inspector-controls' ) ).toBeNull();
		const iframe = container.querySelector( 'iframe.strava-embed-iframe' );
		expect( iframe?.getAttribute( 'src' ) ).toBe(
			'https://strava-embeds.com/activity/123'
		);
	} );

	it( 'disables pointer events on the editor preview iframe so the block stays selectable', () => {
		// Without `pointer-events: none`, clicks land on the cross-origin
		// strava-embeds.com document and never reach the figure that holds
		// `useBlockProps`'s selection handler — the user can no longer pick
		// the block after pasting a Strava URL.
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		const iframe = container.querySelector< HTMLIFrameElement >(
			'iframe.strava-embed-iframe'
		);
		expect( iframe ).not.toBeNull();
		expect( iframe?.style.pointerEvents ).toBe( 'none' );
	} );

	it( "routes the listener through the iframe's owner window so Gutenberg's canvas iframe receives broadcasts", () => {
		// Regression: in Gutenberg's iframe-canvas mode (default since WP
		// 6.3) the block's DOM lives in a child iframe while React stays
		// in the admin window. Strava posts to its own `window.parent` =
		// the canvas window — a listener on `window` never fires. To
		// reproduce the canvas/admin split in jsdom we mount the React
		// tree inside a nested iframe's document and assert that the
		// listener attaches to *that* iframe's window, not the outer one.
		const hostIframe = document.createElement( 'iframe' );
		document.body.appendChild( hostIframe );
		const hostDoc = hostIframe.contentDocument as Document;
		const hostWindow = hostIframe.contentWindow as Window;
		const mountPoint = hostDoc.createElement( 'div' );
		hostDoc.body.appendChild( mountPoint );

		// Track addEventListener('message', …) calls on each candidate
		// window. With the bug, the outer `window` would record the call;
		// with the fix, only `hostWindow` does.
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
			const Wrapped = applyBlockEditFilter( FakeEdit );
			render(
				createElement( Wrapped, {
					name: 'core/embed',
					attributes: {
						providerNameSlug: 'strava',
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

	it( 'sizes the editor preview iframe from BROADCAST_IFRAME_HEIGHT messages', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		const iframe = container.querySelector< HTMLIFrameElement >(
			'iframe.strava-embed-iframe'
		);
		expect( iframe ).not.toBeNull();

		// strava-embeds.com posts `[id, 'BROADCAST_IFRAME_HEIGHT', height]`
		// to its parent. Without source-window verification the listener
		// would obey any frame on the page; firing the event with the
		// iframe's contentWindow as `source` proves the wired path works.
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

	it( 'ignores non-height messages from the iframe (e.g. analytics chatter)', () => {
		// The iframe may post unrelated messages for its own bookkeeping;
		// the listener must hold its current height when the payload isn't
		// a `BROADCAST_IFRAME_HEIGHT` array, instead of falling back to a
		// default that would cancel out a recent valid broadcast.
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
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

	it( 'ignores BROADCAST_IFRAME_HEIGHT messages from other windows', () => {
		// A third-party iframe on the same page (e.g. a Twitter embed below)
		// could otherwise dictate our preview height. The listener gates on
		// `event.source` being our own iframe's contentWindow.
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
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
					// Deliberately not iframe.contentWindow; should be ignored.
					source: window,
				} )
			);
		} );
		expect( iframe?.style.height ).toBe( initialHeight );
	} );

	it( 'renders our iframe + the inspector for Strava route URLs', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
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
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
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
		// Without this, flipping the Embed width radio updates the iframe
		// `src` (`?fullWidth=true`) but the outer iframe element stays clamped
		// at 600px, so the user sees no visible change.
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
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
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
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

	it( 'exposes an Edit URL toolbar button on the rendered preview', () => {
		// Without this, the user has no way back to the URL prompt once a
		// canonical Strava URL is embedded — our editor.BlockEdit override
		// replaces core/embed's whole render path (including its EmbedControls
		// toolbar with the pencil button), so we must surface the affordance
		// ourselves.
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect(
			screen.getByRole( 'button', { name: /edit url/i } )
		).toBeInTheDocument();
	} );

	it( 'switches to a URL placeholder pre-filled with the saved URL when Edit URL is clicked', async () => {
		// Pre-filling lets the user tweak the existing URL (e.g. swap an
		// activity ID) instead of retyping from scratch. Hiding the inspector
		// while editing keeps stale route options out of view — they only
		// make sense once the new URL is committed.
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/routes/456',
				},
				setAttributes: jest.fn(),
			} )
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /edit url/i } )
		);
		const urlInput = screen.getByRole( 'textbox', {
			name: /embed url/i,
		} ) as HTMLInputElement;
		expect( urlInput.value ).toBe( 'https://www.strava.com/routes/456' );
		expect(
			container.querySelector( 'iframe.strava-embed-iframe' )
		).toBeNull();
		expect( screen.queryByTestId( 'inspector-controls' ) ).toBeNull();
	} );

	it( 'commits the new URL via setAttributes and exits edit mode on submit', async () => {
		const setAttributes = jest.fn();
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes,
			} )
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /edit url/i } )
		);
		const urlInput = screen.getByRole( 'textbox', {
			name: /embed url/i,
		} );
		await userEvent.clear( urlInput );
		await userEvent.type(
			urlInput,
			'https://www.strava.com/activities/999'
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /^embed$/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/activities/999',
		} );
	} );

	it( 'trims whitespace from the URL on submit', async () => {
		// `parseStravaUrl` anchors at `^https?`; without trimming, a pasted URL
		// with a leading newline or space would silently fall through to
		// core/embed and the saved attribute would carry the stray characters.
		const setAttributes = jest.fn();
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes,
			} )
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /edit url/i } )
		);
		const urlInput = screen.getByRole( 'textbox', {
			name: /embed url/i,
		} );
		await userEvent.clear( urlInput );
		await userEvent.type(
			urlInput,
			'  https://www.strava.com/activities/999  '
		);
		await userEvent.click(
			screen.getByRole( 'button', { name: /^embed$/i } )
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			url: 'https://www.strava.com/activities/999',
		} );
	} );

	it( 'restores the iframe when Edit URL is toggled off without saving', async () => {
		// Re-clicking the toolbar pencil should cancel the edit and leave the
		// stored URL untouched — otherwise the user has no way to back out of
		// an accidental click.
		const setAttributes = jest.fn();
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/123',
				},
				setAttributes,
			} )
		);
		const editButton = screen.getByRole( 'button', { name: /edit url/i } );
		await userEvent.click( editButton );
		await userEvent.click( editButton );
		expect( setAttributes ).not.toHaveBeenCalled();
		expect(
			container.querySelector( 'iframe.strava-embed-iframe' )
		).not.toBeNull();
	} );

	it( 'falls through to the underlying Edit for short URLs (server-side resolution required)', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://strava.app.link/abc',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.getByTestId( 'fake-edit' ) ).toBeInTheDocument();
	} );

	it( 'falls through to the underlying Edit when the URL is missing', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: { providerNameSlug: 'strava' },
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.getByTestId( 'fake-edit' ) ).toBeInTheDocument();
	} );

	it( 'leaves other block types alone (e.g. core/paragraph)', () => {
		const Wrapped = applyBlockEditFilter( FakeEdit );
		render(
			createElement( Wrapped, {
				name: 'core/paragraph',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/routes/456',
				},
				setAttributes: jest.fn(),
			} )
		);
		expect( screen.getByTestId( 'fake-edit' ) ).toBeInTheDocument();
	} );
} );

describe( 'editor embed-status preflight', () => {
	beforeEach( () => {
		( apiFetch as unknown as jest.Mock ).mockReset();
	} );

	function renderEmbed(
		attributes: EditProps[ 'attributes' ] = {},
		url: string = 'https://www.strava.com/activities/18233733854'
	): { setAttributes: jest.Mock; container: HTMLElement } {
		function FakeEdit() {
			return createElement( 'div', { 'data-testid': 'fake-edit' } );
		}
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const setAttributes = jest.fn();
		const { container } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url,
					...attributes,
				},
				setAttributes,
			} )
		);
		return { setAttributes, container };
	}

	it( 'calls /embed-status when an activity URL has no stored token', async () => {
		( apiFetch as unknown as jest.Mock ).mockResolvedValueOnce( {
			embeddable: true,
			status: 200,
		} );

		renderEmbed();

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/block-for-strava/v1/embed-status?type=activity&id=18233733854',
			} )
		);
	} );

	it( 'shows the snippet notice when an activity URL returns 403', async () => {
		( apiFetch as unknown as jest.Mock ).mockResolvedValueOnce( {
			embeddable: false,
			status: 403,
		} );

		const { container } = renderEmbed();

		await waitFor( () =>
			expect(
				container.querySelector( '[data-testid="strava-embed-notice"]' )
			).toBeInTheDocument()
		);
		/*
		 * The notice text must explicitly point users at the share-dialog
		 * snippet; a generic "this didn't work" message would leave them
		 * stuck without an actionable next step.
		 */
		expect( container.textContent ).toMatch( /embed code|share dialog/i );
	} );

	it( 'does not show a notice when the activity is embeddable', async () => {
		( apiFetch as unknown as jest.Mock ).mockResolvedValueOnce( {
			embeddable: true,
			status: 200,
		} );

		const { container } = renderEmbed();

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		await act( async () => {
			await Promise.resolve();
		} );
		expect(
			container.querySelector( '[data-testid="strava-embed-notice"]' )
		).toBeNull();
	} );

	it( 'does not show the snippet notice for non-403 failures (404, 5xx, etc.)', async () => {
		/*
		 * The "paste the share-dialog snippet" advice only applies to the
		 * 403 EEE case. A 404 (activity deleted) or 5xx (Strava outage)
		 * shouldn't surface the same notice — the user can't fix those
		 * by re-pasting a snippet.
		 */
		( apiFetch as unknown as jest.Mock ).mockResolvedValueOnce( {
			embeddable: false,
			status: 404,
		} );

		const { container } = renderEmbed();

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		await act( async () => {
			await Promise.resolve();
		} );
		expect(
			container.querySelector( '[data-testid="strava-embed-notice"]' )
		).toBeNull();
	} );

	it( 'does not show the snippet notice for a route URL that 403s', async () => {
		/*
		 * Routes don't have a token-paste recovery path; they shouldn't
		 * surface the activity-specific notice text even on a 403.
		 */
		( apiFetch as unknown as jest.Mock ).mockResolvedValueOnce( {
			embeddable: false,
			status: 403,
		} );

		const { container } = renderEmbed(
			{},
			'https://www.strava.com/routes/456'
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		await act( async () => {
			await Promise.resolve();
		} );
		expect(
			container.querySelector( '[data-testid="strava-embed-notice"]' )
		).toBeNull();
	} );

	it( 'skips the preflight when the token is already stored (snippet path)', async () => {
		renderEmbed( { stravaEmbedToken: 'AlReAdYsTored' } );
		await act( async () => {
			await Promise.resolve();
		} );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'preflights routes too (embeddability applies to all types)', async () => {
		( apiFetch as unknown as jest.Mock ).mockResolvedValueOnce( {
			embeddable: true,
			status: 200,
		} );

		renderEmbed( {}, 'https://www.strava.com/routes/456' );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/block-for-strava/v1/embed-status?type=route&id=456',
			} )
		);
	} );

	it( 'silently swallows fetch errors and shows no notice', async () => {
		( apiFetch as unknown as jest.Mock ).mockRejectedValueOnce(
			new Error( 'offline' )
		);

		const { container } = renderEmbed();

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		await act( async () => {
			await Promise.resolve();
		} );
		/*
		 * No notice on transport failure — better to fall through silently
		 * than to misclassify a private activity as public or vice versa.
		 */
		expect(
			container.querySelector( '[data-testid="strava-embed-notice"]' )
		).toBeNull();
	} );

	it( 'ignores a late preflight response when the URL has changed', async () => {
		/*
		 * Fast-typing user pastes one URL and immediately edits to another.
		 * The first preflight is in-flight when the cleanup fires; if we
		 * don't honor the cancellation flag, the stale response could
		 * flip embedStatus from a still-pending fresh request and surface
		 * the wrong notice. This test pins the cancellation guard.
		 */
		let resolveFirst: ( v: {
			embeddable: boolean;
			status: number;
		} ) => void = () => {};
		( apiFetch as unknown as jest.Mock ).mockImplementationOnce(
			() =>
				new Promise( ( res ) => {
					resolveFirst = res;
				} )
		);
		( apiFetch as unknown as jest.Mock ).mockResolvedValueOnce( {
			embeddable: true,
			status: 200,
		} );

		function FakeEdit() {
			return createElement( 'div', { 'data-testid': 'fake-edit' } );
		}
		const Wrapped = applyBlockEditFilter( FakeEdit );
		const { container, rerender } = render(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/111',
				},
				setAttributes: jest.fn(),
			} )
		);
		// Swap to a different activity before the first call resolves.
		rerender(
			createElement( Wrapped, {
				name: 'core/embed',
				attributes: {
					providerNameSlug: 'strava',
					url: 'https://www.strava.com/activities/222',
				},
				setAttributes: jest.fn(),
			} )
		);

		/*
		 * Now resolve the first (now-cancelled) call with a 403
		 * response — its setState must be ignored.
		 */
		await act( async () => {
			resolveFirst( { embeddable: false, status: 403 } );
			await Promise.resolve();
		} );
		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		/*
		 * Drain the second response (which was queued via
		 * mockResolvedValueOnce above).
		 */
		await act( async () => {
			await Promise.resolve();
		} );
		expect(
			container.querySelector( '[data-testid="strava-embed-notice"]' )
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

	it( 'appends `?token=` for activity URLs when the token attribute is set', () => {
		/*
		 * Without this, token-gated activities (private/followers-only)
		 * 403 in the editor preview even though the snippet paste flow
		 * stored the token. The PHP renderer honors the same attribute
		 * at front-end render time so the editor and the published page
		 * stay in lockstep.
		 */
		const url = new URL(
			buildEmbedUrl(
				{ type: 'activity', id: '18233733854' },
				{ stravaEmbedToken: 'gS4P2Fvt-Vc' }
			)
		);
		expect( url.pathname ).toBe( '/activity/18233733854' );
		expect( url.searchParams.get( 'token' ) ).toBe( 'gS4P2Fvt-Vc' );
	} );

	it( 'omits token param when the attribute is empty', () => {
		expect(
			buildEmbedUrl(
				{ type: 'activity', id: '123' },
				{ stravaEmbedToken: '' }
			)
		).toBe( 'https://strava-embeds.com/activity/123' );
	} );

	it( 'preserves the token alongside route params for routes', () => {
		const url = new URL(
			buildEmbedUrl(
				{ type: 'route', id: '456' },
				{
					stravaEmbedToken: 'rOuTeToken',
					stravaRouteMapStyle: 'satellite',
				}
			)
		);
		expect( url.searchParams.get( 'token' ) ).toBe( 'rOuTeToken' );
		expect( url.searchParams.get( 'style' ) ).toBe( 'satellite' );
	} );

	it( 'omits default `style=standard` when only the token is set on a route', () => {
		/*
		 * PHP's `route_params_from_attrs()` returns `[]` when only the
		 * default `style` would be emitted, then adds the token. The
		 * editor must do the same so a route block with a token but no
		 * route customization renders byte-identical iframe URLs on
		 * both sides.
		 */
		expect(
			buildEmbedUrl(
				{ type: 'route', id: '456' },
				{ stravaEmbedToken: 'rOuTeToken' }
			)
		).toBe( 'https://strava-embeds.com/route/456?token=rOuTeToken' );
	} );
} );

describe( 'parseStravaHeightMessage', () => {
	it( 'returns the height for a well-formed BROADCAST_IFRAME_HEIGHT array', () => {
		expect(
			parseStravaHeightMessage( [ 0, 'BROADCAST_IFRAME_HEIGHT', 412 ] )
		).toBe( 412 );
	} );

	it( 'clamps unreasonably small heights up to the floor', () => {
		// A 10px broadcast almost certainly indicates Strava measured the
		// iframe before its content rendered; honoring it would crush the
		// preview to a sliver. Clamp to a usable minimum instead.
		expect(
			parseStravaHeightMessage( [ 0, 'BROADCAST_IFRAME_HEIGHT', 10 ] )
		).toBe( 100 );
	} );

	it( 'clamps unreasonably large heights down to the ceiling', () => {
		// Symmetric guard: a runaway height (e.g. measurement bug, malicious
		// frame) would otherwise turn the editor preview into a giant
		// scrolling void.
		expect(
			parseStravaHeightMessage( [ 0, 'BROADCAST_IFRAME_HEIGHT', 99999 ] )
		).toBe( 5000 );
	} );

	it( 'rejects non-array payloads', () => {
		expect(
			parseStravaHeightMessage( 'BROADCAST_IFRAME_HEIGHT' )
		).toBeNull();
		expect(
			parseStravaHeightMessage( {
				stravaEmbedHeight: 500,
			} )
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

describe( 'StravaRouteInspector controls', () => {
	function renderWith( attributes: EditProps[ 'attributes' ] = {} ) {
		const setAttributes = jest.fn();
		render(
			createElement( StravaRouteInspector, {
				name: 'core/embed',
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
		// Hand-edited block comments can persist arbitrary strings; the
		// inspector reads through a clamp so the visible state never
		// disagrees with what the renderer accepts.
		renderWith( {
			stravaRouteMapStyle: 'invalid' as 'standard',
			stravaRouteTerrain: 'bogus' as 'auto',
			stravaRouteUnits: 'unknown' as 'auto',
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
