/**
 * Edit component for the Strava embed block.
 *
 * Two visible states:
 * - URL placeholder when no URL has been set, or when the user clicks the
 *   pencil toolbar button to edit an existing URL.
 * - Iframe preview when a canonical Strava URL is set; for routes the
 *   inspector exposes Strava's documented per-embed knobs.
 *
 * Short URLs (`strava.app.link/...`) need server-side resolution to map to a
 * canonical type+id, so the editor preview shows a passthrough notice — the
 * published page still renders correctly because the PHP render callback
 * resolves the short URL there.
 */
import {
	BlockControls,
	useBlockProps,
	InspectorControls,
	RichText,
} from '@wordpress/block-editor';
import {
	Button,
	PanelBody,
	Placeholder,
	RadioControl,
	SelectControl,
	ToggleControl,
	ToolbarButton,
	ToolbarGroup,
} from '@wordpress/components';
import {
	Fragment,
	createElement,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';
import type { ChangeEvent, FormEvent } from 'react';
import { __ } from '@wordpress/i18n';
import {
	caption as captionIcon,
	chartBar as stravaIcon,
	pencil as editIcon,
} from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';

import {
	CANONICAL_STRAVA_URL_PARSE,
	SHORT_STRAVA_URL_PATTERN,
	URL_PATH_TO_TYPE,
} from './strava-url-patterns';

type RouteMapStyle =
	| 'standard'
	| 'satellite'
	| 'hybrid'
	| 'dark'
	| 'winter'
	| 'light';
type RouteUnits = 'auto' | 'metric' | 'imperial';
type RouteTerrain = 'auto' | '2d' | '3d';

type PreflightStatus = 'unknown' | 'needs-token';

/*
 * Block.json declares `enum` constraints for the route attributes, so on
 * happy-path inputs the strings that reach this component are within the
 * documented set. The interface stays widened to plain `string` because
 * `clampEnum`/`clampBool` is the load-bearing defense at the render call
 * site for older posts that pre-date the schema or for attribute values
 * that bypass schema validation in older Gutenberg builds.
 */
export interface StravaBlockAttributes {
	url?: string;
	stravaRouteMapStyle?: string;
	stravaRouteTerrain?: string;
	stravaRouteUnits?: string;
	stravaRouteFullWidth?: boolean;
	stravaRouteShowDirt?: boolean;
	stravaRouteShowElevation?: boolean;
	/*
	 * Strava share token used for non-public embeds. Activities are the
	 * motivating case (Strava 403s a tokenless iframe URL for any activity
	 * not visibility=Everyone), but the token is also threaded through
	 * for routes and segments when the snippet-paste flow carries one —
	 * `buildEmbedUrl` and the PHP renderer both round-trip it for any
	 * type so editor and front-end URLs match exactly.
	 *
	 * Only the snippet-paste path (`src/snippet-transform`) writes it —
	 * the token isn't discoverable server-side from a URL alone, so a
	 * URL-only paste leaves this empty and the preflight effect below
	 * (activity-only) surfaces a notice instructing the user to paste
	 * the share-dialog snippet instead. Empty string also covers
	 * public-Everyone embeds, which don't need a token at all.
	 */
	stravaEmbedToken?: string;
	caption?: string;
}

export interface BlockEditProps {
	attributes: StravaBlockAttributes;
	setAttributes: ( attrs: Partial< StravaBlockAttributes > ) => void;
	/*
	 * Gutenberg passes this on every edit; the component does not
	 * currently consume it (caption visibility is driven by an
	 * explicit toolbar toggle, not selection state) but it stays in
	 * the type so the props contract matches what Gutenberg passes.
	 */
	isSelected?: boolean;
}

const ROUTE_MAP_STYLES: ReadonlyArray< RouteMapStyle > = [
	'standard',
	'satellite',
	'hybrid',
	'dark',
	'winter',
	'light',
];
const ROUTE_UNITS: ReadonlyArray< RouteUnits > = [
	'auto',
	'metric',
	'imperial',
];
const ROUTE_TERRAINS: ReadonlyArray< RouteTerrain > = [ 'auto', '2d', '3d' ];

interface ResolvedStravaUrl {
	type: 'activity' | 'route' | 'segment';
	id: string;
}

export function parseStravaUrl( url: string ): ResolvedStravaUrl | null {
	const match = CANONICAL_STRAVA_URL_PARSE.exec( url );
	if ( ! match ) {
		return null;
	}
	return {
		type: URL_PATH_TO_TYPE[ match[ 1 ].toLowerCase() ],
		id: match[ 2 ],
	};
}

/**
 * Builds the strava-embeds.com URL for a canonical resource, including
 * route-specific query params when the user has overridden any default.
 *
 * @param resolved Resolved type+id from `parseStravaUrl`.
 * @param attrs    Block attributes carrying optional `stravaRoute*` fields.
 */
export function buildEmbedUrl(
	resolved: ResolvedStravaUrl,
	attrs: StravaBlockAttributes
): string {
	const base = `https://strava-embeds.com/${ resolved.type }/${ resolved.id }`;
	const token = clampString( attrs.stravaEmbedToken );

	if ( 'route' !== resolved.type ) {
		// Activities and segments only ever take the token.
		return token
			? `${ base }?token=${ encodeURIComponent( token ) }`
			: base;
	}

	const mapStyle = clampEnum(
		attrs.stravaRouteMapStyle,
		ROUTE_MAP_STYLES,
		'standard'
	);
	const terrain = clampEnum(
		attrs.stravaRouteTerrain,
		ROUTE_TERRAINS,
		'auto'
	);
	const units = clampEnum( attrs.stravaRouteUnits, ROUTE_UNITS, 'auto' );
	const showElevation = clampBool( attrs.stravaRouteShowElevation, true );
	const fullWidth = clampBool( attrs.stravaRouteFullWidth, false );
	const showDirt = clampBool( attrs.stravaRouteShowDirt, false );

	/*
	 * `style` is always set so the URL stays in lockstep with the PHP-side
	 * `route_params_from_attrs`, then dropped only when it would be the
	 * sole param at its default. Without this the editor preview would
	 * render `?terrain=3d` while the published page renders
	 * `?style=standard&terrain=3d` for the same saved attributes — a
	 * minor URL-string drift that a CDN cache or analytics pixel can
	 * surface as two distinct requests.
	 */
	const params = new URLSearchParams();
	let nonDefaultParamCount = 0;
	params.set( 'style', mapStyle );
	if ( ! showElevation ) {
		params.set( 'hideElevation', 'true' );
		nonDefaultParamCount++;
	}
	if ( 'auto' !== units ) {
		params.set( 'units', units );
		nonDefaultParamCount++;
	}
	if ( fullWidth ) {
		params.set( 'fullWidth', 'true' );
		nonDefaultParamCount++;
	}
	if ( 'auto' !== terrain ) {
		params.set( 'terrain', terrain );
		nonDefaultParamCount++;
	}
	if ( showDirt ) {
		params.set( 'surfaceType', 'true' );
		nonDefaultParamCount++;
	}

	if ( 0 === nonDefaultParamCount && 'standard' === mapStyle ) {
		return token
			? `${ base }?token=${ encodeURIComponent( token ) }`
			: base;
	}
	if ( token ) {
		params.set( 'token', token );
	}
	return `${ base }?${ params.toString() }`;
}

/*
 * Defense in depth on top of the block.json enum: an attribute value that
 * bypasses schema validation (older WP builds, hand-rolled block markup,
 * legacy posts saved before enums existed) would otherwise pass straight
 * through to Strava's iframe URL and silently fall back to default
 * behavior. Reading attributes through this clamp keeps the inspector
 * controls in sync with what the renderer accepts.
 */
function clampEnum< T extends string >(
	value: unknown,
	allowed: ReadonlyArray< T >,
	fallback: T
): T {
	return typeof value === 'string' &&
		( allowed as ReadonlyArray< string > ).includes( value )
		? ( value as T )
		: fallback;
}

function clampBool( value: unknown, fallback: boolean ): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function clampString( value: unknown ): string {
	return typeof value === 'string' ? value : '';
}

export function StravaRouteInspector( {
	attributes,
	setAttributes,
}: BlockEditProps ) {
	const mapStyle = clampEnum(
		attributes.stravaRouteMapStyle,
		ROUTE_MAP_STYLES,
		'standard'
	);
	const terrain = clampEnum(
		attributes.stravaRouteTerrain,
		ROUTE_TERRAINS,
		'auto'
	);
	const units = clampEnum( attributes.stravaRouteUnits, ROUTE_UNITS, 'auto' );
	const fullWidth = clampBool( attributes.stravaRouteFullWidth, false );
	const showDirt = clampBool( attributes.stravaRouteShowDirt, false );
	const showElevation = clampBool(
		attributes.stravaRouteShowElevation,
		true
	);

	return createElement(
		InspectorControls,
		null,
		createElement(
			PanelBody,
			{
				title: __( 'Route options', 'block-for-strava' ),
				initialOpen: true,
			},
			createElement( ToggleControl, {
				label: __( 'Show elevation profile', 'block-for-strava' ),
				checked: showElevation,
				onChange: ( value: boolean ) =>
					setAttributes( { stravaRouteShowElevation: value } ),
			} ),
			createElement( RadioControl, {
				label: __( 'Units', 'block-for-strava' ),
				selected: units,
				options: [
					{ label: __( 'Auto', 'block-for-strava' ), value: 'auto' },
					{
						label: __( 'Metric', 'block-for-strava' ),
						value: 'metric',
					},
					{
						label: __( 'Imperial', 'block-for-strava' ),
						value: 'imperial',
					},
				],
				onChange: ( value: string ) =>
					setAttributes( {
						stravaRouteUnits: clampEnum(
							value,
							ROUTE_UNITS,
							'auto'
						),
					} ),
			} ),
			createElement( RadioControl, {
				label: __( 'Embed width', 'block-for-strava' ),
				selected: fullWidth ? 'responsive' : 'fixed',
				options: [
					{
						label: __( 'Fixed', 'block-for-strava' ),
						value: 'fixed',
					},
					{
						label: __( 'Responsive', 'block-for-strava' ),
						value: 'responsive',
					},
				],
				onChange: ( value: string ) =>
					setAttributes( {
						stravaRouteFullWidth: 'responsive' === value,
					} ),
			} ),
			createElement( SelectControl, {
				label: __( 'Map style', 'block-for-strava' ),
				value: mapStyle,
				options: ROUTE_MAP_STYLES.map( ( style ) => ( {
					value: style,
					label: style.charAt( 0 ).toUpperCase() + style.slice( 1 ),
				} ) ),
				onChange: ( value: string ) =>
					setAttributes( {
						stravaRouteMapStyle: clampEnum(
							value,
							ROUTE_MAP_STYLES,
							'standard'
						),
					} ),
			} ),
			createElement( RadioControl, {
				label: __( 'Terrain', 'block-for-strava' ),
				selected: terrain,
				options: [
					{ label: __( 'Auto', 'block-for-strava' ), value: 'auto' },
					{ label: __( '2D', 'block-for-strava' ), value: '2d' },
					{ label: __( '3D', 'block-for-strava' ), value: '3d' },
				],
				onChange: ( value: string ) =>
					setAttributes( {
						stravaRouteTerrain: clampEnum(
							value,
							ROUTE_TERRAINS,
							'auto'
						),
					} ),
			} ),
			createElement( ToggleControl, {
				label: __( 'Highlight unpaved surfaces', 'block-for-strava' ),
				checked: showDirt,
				onChange: ( value: boolean ) =>
					setAttributes( { stravaRouteShowDirt: value } ),
			} )
		)
	);
}

/*
 * Initial editor-preview height. Strava's embed page broadcasts its actual
 * rendered height via `BROADCAST_IFRAME_HEIGHT` shortly after load, so we
 * pick a value sized for the tallest case (a route with elevation profile);
 * shorter content shrinks to its real height when the broadcast lands.
 */
const DEFAULT_PREVIEW_HEIGHT = 730;

/*
 * Sanity guards on the height we'll accept from a postMessage. The
 * source-window check on the listener already gates out non-Strava
 * frames; this clamp catches measurement glitches from strava-embeds.com
 * itself driving the editor preview to 1px or 50000px.
 */
const MIN_PREVIEW_HEIGHT = 100;
const MAX_PREVIEW_HEIGHT = 5000;

/**
 * Decodes a `BROADCAST_IFRAME_HEIGHT` postMessage from `strava-embeds.com`,
 * returning the clamped pixel height to apply or `null` if the payload
 * isn't a recognized height broadcast.
 *
 * Strava's embed page posts `[id, 'BROADCAST_IFRAME_HEIGHT', height]` to
 * its parent window once layout settles. Returning `null` for malformed
 * payloads keeps the caller branch-free — a height of `0` from a malformed
 * message would otherwise be ambiguous with "ignore this message."
 *
 * @param data Untyped MessageEvent.data value.
 */
export function parseStravaHeightMessage( data: unknown ): number | null {
	if (
		! Array.isArray( data ) ||
		'BROADCAST_IFRAME_HEIGHT' !== data[ 1 ] ||
		'number' !== typeof data[ 2 ] ||
		! Number.isFinite( data[ 2 ] )
	) {
		return null;
	}
	return Math.min(
		Math.max( data[ 2 ], MIN_PREVIEW_HEIGHT ),
		MAX_PREVIEW_HEIGHT
	);
}

/**
 * Renders the URL prompt placeholder for an unset (or being-edited) URL.
 *
 * Surfaced as a separate component so the iframe preview path doesn't have
 * to mount the form when it isn't visible.
 *
 * @param props            Component props.
 * @param props.initialUrl Pre-fills the input — the saved URL when the
 *                         user clicks Edit URL, empty for first-time use.
 * @param props.onSubmit   Receives the trimmed URL when the form submits.
 */
function StravaUrlPlaceholder( {
	initialUrl,
	onSubmit,
}: {
	initialUrl: string;
	onSubmit: ( url: string ) => void;
} ) {
	const [ urlInput, setUrlInput ] = useState( initialUrl );

	const submit = ( event: FormEvent< HTMLFormElement > ) => {
		event.preventDefault();
		/*
		 * Trim before saving: `parseStravaUrl` anchors at `^https?` so a
		 * leading newline or space from a clipboard paste would silently
		 * fall through and the saved attribute would carry the stray
		 * whitespace forward.
		 */
		onSubmit( urlInput.trim() );
	};

	return createElement(
		Placeholder,
		{
			icon: stravaIcon,
			label: __( 'Strava', 'block-for-strava' ),
			instructions: __(
				'Paste a Strava activity, route, or segment URL.',
				'block-for-strava'
			),
		},
		createElement(
			'form',
			{
				className: 'block-library-embed__form',
				onSubmit: submit,
			},
			createElement( 'input', {
				type: 'url',
				value: urlInput,
				className: 'components-placeholder__input',
				'aria-label': __( 'Embed URL', 'block-for-strava' ),
				placeholder: __(
					'Enter URL to embed here…',
					'block-for-strava'
				),
				onChange: ( event: ChangeEvent< HTMLInputElement > ) =>
					setUrlInput( event.target.value ),
			} ),
			createElement(
				Button,
				{ variant: 'primary', type: 'submit' },
				__( 'Embed', 'block-for-strava' )
			)
		)
	);
}

/**
 * Renders the canonical-URL preview: an iframe pointing at strava-embeds.com
 * with route options baked into the URL query, plus the inspector for routes.
 *
 * @param props               Component props.
 * @param props.resolved      The {type, id} pair `parseStravaUrl` returned —
 *                            drives both the iframe path and whether the
 *                            route inspector mounts.
 * @param props.attributes    Block attributes (URL + optional route knobs).
 * @param props.setAttributes Standard Gutenberg setter, threaded into the
 *                            inspector.
 */
function StravaCanonicalPreview( {
	resolved,
	attributes,
	setAttributes,
}: BlockEditProps & { resolved: ResolvedStravaUrl } ) {
	const storedToken = clampString( attributes.stravaEmbedToken );
	const [ preflight, setPreflight ] =
		useState< PreflightStatus >( 'unknown' );

	/*
	 * Preflight Strava's iframe URL on the user's behalf so we can warn
	 * before save when an activity URL alone won't render. Strava's
	 * per-activity share token isn't discoverable server-side (it's only
	 * minted into the share dialog for a logged-in browser session), so
	 * the only actionable signal we can give is "this URL paste won't
	 * work — paste the embed code from Strava's share dialog instead."
	 *
	 * Gated to activities because the snippet workaround only applies
	 * there. Skipped when a token is already stored — the snippet-paste
	 * flow is the other source of one and its iframe is guaranteed to
	 * render.
	 */
	useEffect( () => {
		setPreflight( 'unknown' );
		if ( '' !== storedToken || 'activity' !== resolved.type ) {
			return;
		}
		let cancelled = false;
		apiFetch< { embeddable: boolean; status: number } >( {
			path: `/block-for-strava/v1/embed-status?type=${ encodeURIComponent(
				resolved.type
			) }&id=${ encodeURIComponent( resolved.id ) }`,
		} )
			.then( ( response ) => {
				if ( cancelled ) {
					return;
				}
				/*
				 * Only 403 has an actionable user recovery (paste the
				 * share-dialog snippet). 404s, 5xxs, and transport
				 * failures stay `unknown`, the iframe renders, and the
				 * user sees Strava's real response — better than a
				 * notice giving advice that doesn't apply.
				 */
				if ( 403 === response?.status ) {
					setPreflight( 'needs-token' );
				}
			} )
			.catch( () => {
				// Transport failure: stay `unknown`, let the iframe try.
			} );
		return () => {
			cancelled = true;
		};
	}, [ resolved.type, resolved.id, storedToken ] );

	/*
	 * `needs-token` only fires when storedToken is empty, so deriving
	 * the rendered status from preflight directly is correct: when a
	 * token is set the effect early-returns without touching state, and
	 * we already know the iframe will render.
	 */
	const showNeedsTokenNotice = 'needs-token' === preflight;

	const src = buildEmbedUrl( resolved, attributes );

	const iframeRef = useRef< HTMLIFrameElement | null >( null );
	const [ height, setHeight ] = useState( DEFAULT_PREVIEW_HEIGHT );

	/*
	 * Reset to the default whenever the iframe URL changes — toggling
	 * between two routes (or flipping a route option that re-keys the src)
	 * would otherwise leave the preview stuck at the prior content's
	 * height until the new page broadcasts. A momentary 730px is preferable
	 * to a stale value from the previous embed.
	 */
	useEffect( () => {
		setHeight( DEFAULT_PREVIEW_HEIGHT );
	}, [ src ] );

	useEffect( () => {
		/*
		 * Gutenberg's iframe-based block canvas (default since WP 6.3) puts
		 * the block's DOM inside an `editor-canvas` iframe while the React
		 * tree itself stays in the top-level admin window — so `window`
		 * here is the *admin* window, not the canvas. Strava posts to its
		 * own `window.parent`, which is the canvas window, so a listener on
		 * `window` would never fire. Hooking onto the iframe's owner window
		 * lands on the right document in either layout (iframe-canvas or
		 * legacy in-place).
		 *
		 * `iframeRef.current` is guaranteed non-null here: refs commit
		 * before effects run, and the iframe is part of this component's
		 * own render output. `ownerDocument.defaultView` is non-null for
		 * any document attached to a browsing context — including jsdom's
		 * default document.
		 */
		const targetWindow = iframeRef.current!.ownerDocument.defaultView!;
		const handler = ( event: MessageEvent ) => {
			/*
			 * Source-window check rather than origin: a sandboxed iframe's
			 * effective origin is opaque, and we want the listener to be
			 * scoped to *this* preview specifically — any other Strava
			 * embed elsewhere on the page would otherwise drive our height.
			 */
			if ( event.source !== iframeRef.current?.contentWindow ) {
				return;
			}
			const next = parseStravaHeightMessage( event.data );
			if ( null !== next ) {
				setHeight( next );
			}
		};
		targetWindow.addEventListener( 'message', handler );
		return () => targetWindow.removeEventListener( 'message', handler );
	}, [] );

	/*
	 * Mirror the frontend `build_iframe` width contract so the editor preview
	 * actually changes when the Embed width toggle is flipped. With
	 * fullWidth=false the iframe is capped at 600px (matches Strava's stock
	 * fixed embed); with fullWidth=true the cap is dropped so the iframe
	 * fills its container. Without this the iframe always rendered 100% wide
	 * and the Fixed/Responsive radio looked broken.
	 */
	const isRoute = 'route' === resolved.type;
	const fullWidth =
		isRoute && clampBool( attributes.stravaRouteFullWidth, false );

	return createElement(
		Fragment,
		null,
		isRoute
			? createElement( StravaRouteInspector, {
					attributes,
					setAttributes,
			  } )
			: null,
		showNeedsTokenNotice
			? createElement(
					'div',
					{
						'data-testid': 'strava-embed-notice',
						className: 'block-for-strava-notice',
						/*
						 * `role="status"` + `aria-live="polite"` so screen
						 * readers announce the notice when the preflight
						 * resolves to 'needs-token', without the more
						 * intrusive `role="alert"` semantics that would
						 * preempt the user's current focus. The notice is
						 * informational, not time-critical.
						 */
						role: 'status',
						'aria-live': 'polite',
						style: {
							padding: '12px 16px',
							marginBottom: '8px',
							border: '1px solid #ddd',
							borderLeft: '4px solid #fc5200',
							background: '#fff8f3',
							fontSize: '13px',
							lineHeight: '1.5',
						},
					},
					__(
						'This Strava activity isn’t set to public visibility, so the URL alone won’t embed. Open the activity on Strava, click Share → Embed, and paste the embed code here instead of the URL.',
						'block-for-strava'
					)
			  )
			: null,
		createElement(
			'div',
			{ className: 'wp-block-embed__wrapper' },
			createElement( 'iframe', {
				ref: iframeRef,
				className: 'strava-embed-iframe',
				src,
				sandbox:
					'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
				referrerPolicy: 'origin',
				scrolling: 'no',
				title: __( 'Strava embed', 'block-for-strava' ),
				style: {
					width: '100%',
					maxWidth: fullWidth ? undefined : '600px',
					height: `${ height }px`,
					border: 0,
					display: 'block',
					/*
					 * Without `pointer-events: none`, clicks land on the
					 * cross-origin strava-embeds.com document and never
					 * reach the figure that holds `useBlockProps`'s
					 * selection handler — the user can no longer pick the
					 * block after pasting a Strava URL.
					 */
					pointerEvents: 'none',
				},
			} )
		)
	);
}

/**
 * Renders a passthrough notice for short URLs.
 *
 * Short URLs (`strava.app.link/...`) need a server-side HEAD-redirect chase
 * to map to a canonical type+id, so the editor preview can't render an
 * iframe directly without a REST round-trip. Show a short notice instead;
 * the published page resolves the short URL via the PHP render callback.
 *
 * @param props     Component props.
 * @param props.url The unresolved short URL.
 */
function StravaShortUrlNotice( { url }: { url: string } ) {
	return createElement(
		Placeholder,
		{
			icon: stravaIcon,
			label: __( 'Strava', 'block-for-strava' ),
			instructions: __(
				'Short URL — preview will appear on the published page.',
				'block-for-strava'
			),
		},
		createElement( 'p', { className: 'block-for-strava-short-url' }, url )
	);
}

/**
 * Top-level Edit component. Routes between four states based on the URL:
 * empty/being-edited → placeholder, canonical URL → iframe + inspector,
 * short URL → notice, otherwise → unrecognized-URL placeholder.
 *
 * @param props               Standard block edit props.
 * @param props.attributes    Block attributes; `url` drives the dispatch.
 * @param props.setAttributes Standard Gutenberg setter for committing the
 *                            URL back when the placeholder form submits.
 */
export function Edit( { attributes, setAttributes }: BlockEditProps ) {
	const blockProps = useBlockProps( {
		className:
			'wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava',
	} );

	const url = attributes.url ?? '';
	const [ isEditingURL, setIsEditingURL ] = useState( ! url );
	/*
	 * Caption is opt-in via a toolbar toggle, matching `core/embed`. Lazy
	 * init from the attribute keeps a transferred caption visible after
	 * `core/embed → strava` transforms (which carry `caption` over via
	 * `embed-transform.ts`) — without it the text would survive in the
	 * attribute and render on the front end while the editor field
	 * stayed hidden.
	 */
	const [ showCaption, setShowCaption ] = useState< boolean >(
		() => !! clampString( attributes.caption )
	);

	const submitURL = ( next: string ) => {
		/*
		 * Clear the token only when the canonical resource changes.
		 * Tokens are per-resource (Strava mints one per activity / route
		 * / segment), so a token left over from a previous activity would
		 * silently get appended to the new iframe URL — and
		 * `'' !== storedToken` would skip the preflight, suppressing the
		 * "needs token" notice for an iframe that's actually broken.
		 * Re-submitting the same resource (e.g. fixing a typo, adding a
		 * tracking query param that doesn't change the parsed type+id)
		 * preserves a valid token. The snippet-paste flow sets url +
		 * token together via `createBlock`, so it isn't affected.
		 */
		const previousResolved = parseStravaUrl( url );
		const nextResolved = parseStravaUrl( next );
		const isSameResource =
			null !== previousResolved &&
			null !== nextResolved &&
			previousResolved.type === nextResolved.type &&
			previousResolved.id === nextResolved.id;
		setAttributes(
			isSameResource ? { url: next } : { url: next, stravaEmbedToken: '' }
		);
		setIsEditingURL( false );
	};

	const toggleEditingURL = () => {
		setIsEditingURL( ( prev ) => ! prev );
	};

	const resolved = parseStravaUrl( url );
	const isShortUrl = ! resolved && SHORT_STRAVA_URL_PATTERN.test( url );
	const isRecognizedUrl = null !== resolved || isShortUrl;

	const caption = clampString( attributes.caption );
	const toggleCaption = () => {
		setShowCaption( ( prev ) => {
			const next = ! prev;
			/*
			 * Toggling off discards any existing caption text. The PHP
			 * renderer emits `<figcaption>` whenever the attribute has
			 * non-whitespace content, so leaving stale text behind would
			 * render on the published page even though the editor hides
			 * the field — `core/embed` clears on toggle-off for the same
			 * reason.
			 */
			if ( ! next && '' !== caption ) {
				setAttributes( { caption: '' } );
			}
			return next;
		} );
	};

	let body;
	if ( isEditingURL || ! url ) {
		body = createElement( StravaUrlPlaceholder, {
			initialUrl: url,
			onSubmit: submitURL,
		} );
	} else if ( resolved ) {
		body = createElement( StravaCanonicalPreview, {
			resolved,
			attributes,
			setAttributes,
		} );
	} else if ( isShortUrl ) {
		body = createElement( StravaShortUrlNotice, { url } );
	} else {
		body = createElement( Placeholder, {
			icon: stravaIcon,
			label: __( 'Strava', 'block-for-strava' ),
			instructions: __(
				'This URL is not a recognized Strava activity, route, or segment.',
				'block-for-strava'
			),
		} );
	}

	/*
	 * Caption is gated on four conditions:
	 *
	 * - URL is set (no caption in the placeholder state).
	 * - Not currently editing the URL (the URL form is the focused
	 *   action; the caption field underneath would split attention).
	 * - The URL is recognized (canonical via `resolved` or a short
	 *   URL the front end will resolve). The "unrecognized URL"
	 *   state has `render_block()` returning an empty string, so any
	 *   caption authored there silently disappears on the front end.
	 * - The user has toggled the caption on via the toolbar button.
	 */
	const renderCaption =
		!! url && ! isEditingURL && isRecognizedUrl && showCaption;
	/*
	 * The caption toggle button stays out of the URL-edit and
	 * unrecognized-URL flows for the same reason `renderCaption`
	 * does — flipping it on in those states would either compete
	 * with the URL form or author content that never renders on the
	 * front end.
	 */
	const showCaptionToolbarButton =
		!! url && ! isEditingURL && isRecognizedUrl;

	return createElement(
		Fragment,
		null,
		url
			? createElement(
					BlockControls,
					null,
					createElement(
						ToolbarGroup,
						null,
						createElement( ToolbarButton, {
							icon: editIcon,
							label: __( 'Edit URL', 'block-for-strava' ),
							onClick: toggleEditingURL,
							isActive: isEditingURL,
						} ),
						showCaptionToolbarButton
							? createElement( ToolbarButton, {
									icon: captionIcon,
									label: showCaption
										? __(
												'Remove caption',
												'block-for-strava'
										  )
										: __(
												'Add caption',
												'block-for-strava'
										  ),
									onClick: toggleCaption,
									isActive: showCaption,
							  } )
							: null
					)
			  )
			: null,
		createElement(
			'figure',
			blockProps,
			body,
			renderCaption
				? createElement( RichText, {
						tagName: 'figcaption',
						className: 'wp-element-caption',
						placeholder: __( 'Add caption', 'block-for-strava' ),
						value: caption,
						onChange: ( value: string ) =>
							setAttributes( { caption: value } ),
						'aria-label': __(
							'Strava embed caption',
							'block-for-strava'
						),
				  } )
				: null
		)
	);
}
