/**
 * Route-specific customization controls for the Strava embed variation.
 *
 * Block variations can't carry their own attributes or transforms, so we
 * extend `core/embed` itself with route-only attributes via the
 * `blocks.registerBlockType` filter and override the editor preview through
 * `editor.BlockEdit` for any Strava-variation embed pointing at a canonical
 * URL we can resolve client-side. The override:
 *
 * - Renders the iframe ourselves with route options baked into the URL as
 *   query params, so toggling a control updates the preview in real time
 *   (core/embed's preview comes from a per-URL cached oEmbed response and
 *   wouldn't reflect attribute changes alone).
 * - Surfaces the route options panel for route URLs only; activity and
 *   segment URLs render the same iframe without the panel since Strava's
 *   share dialog doesn't expose these knobs for those types.
 *
 * Short URLs (`strava.app.link/…`) require server-side resolution, so the
 * override falls back to core/embed's default Edit until the URL has been
 * resolved into the canonical form.
 */
import { addFilter } from '@wordpress/hooks';
import {
	BlockControls,
	useBlockProps,
	InspectorControls,
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
	type ComponentType,
} from '@wordpress/element';
import type { ChangeEvent, FormEvent } from 'react';
import { __ } from '@wordpress/i18n';
import { chartBar as stravaIcon, pencil as editIcon } from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';

type RouteMapStyle =
	| 'standard'
	| 'satellite'
	| 'hybrid'
	| 'dark'
	| 'winter'
	| 'light';
type RouteUnits = 'auto' | 'metric' | 'imperial';
type RouteTerrain = 'auto' | '2d' | '3d';

/*
 * Hand-edited block comments and old block markup can persist arbitrary
 * strings outside the documented enums; the inspector reads through
 * `clampEnum`/`clampBool` so out-of-range values are normalized at render
 * time. That makes tightening to literal types (e.g. `RouteMapStyle`) a
 * lie — what the component actually accepts is a wider union.
 */
interface StravaRouteAttributes {
	providerNameSlug?: string;
	url?: string;
	stravaRouteMapStyle?: string;
	stravaRouteTerrain?: string;
	stravaRouteUnits?: string;
	stravaRouteFullWidth?: boolean;
	stravaRouteShowDirt?: boolean;
	stravaRouteShowElevation?: boolean;
	/*
	 * Per-activity share token Strava issues for non-public activities.
	 * Only the snippet-paste path (`src/snippet-transform`) writes it —
	 * the token isn't discoverable server-side from a URL alone, so a
	 * URL-only paste leaves this empty and the preflight effect below
	 * surfaces a notice instructing the user to paste the share-dialog
	 * snippet instead. Empty string also covers public-Everyone
	 * activities, which don't need a token at all.
	 */
	stravaEmbedToken?: string;
}

interface BlockEditProps {
	name: string;
	attributes: StravaRouteAttributes;
	setAttributes: ( attrs: Partial< StravaRouteAttributes > ) => void;
}

interface AttributeSpec {
	type: 'string' | 'boolean';
	default?: unknown;
	enum?: ReadonlyArray< string >;
}

interface BlockTypeSettings {
	attributes?: Record< string, AttributeSpec >;
	[ key: string ]: unknown;
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

/*
 * Captures `(type, id)` from a canonical Strava URL so the editor preview
 * can build the iframe directly. The trailing `(?=[/?#]|$)` mirrors the PHP
 * boundary so `/routes/123abc` doesn't match as route 123. Short URLs need
 * a server hop to resolve; the BlockEdit override falls back to core/embed
 * when the URL hasn't been resolved into the canonical form yet.
 */
const CANONICAL_STRAVA_URL_RE =
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/(activities|routes|segments)\/(\d+)(?=[/?#]|$)/i;

const URL_PATH_TO_TYPE: Record< string, 'activity' | 'route' | 'segment' > = {
	activities: 'activity',
	routes: 'route',
	segments: 'segment',
};

interface ResolvedStravaUrl {
	type: 'activity' | 'route' | 'segment';
	id: string;
}

function parseStravaUrl( url: string ): ResolvedStravaUrl | null {
	const match = CANONICAL_STRAVA_URL_RE.exec( url );
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
	attrs: StravaRouteAttributes
): string {
	const base = `https://strava-embeds.com/${ resolved.type }/${ resolved.id }`;
	const token =
		typeof attrs.stravaEmbedToken === 'string'
			? attrs.stravaEmbedToken
			: '';
	if ( 'route' !== resolved.type ) {
		/*
		 * Activities and segments only ever take a single param (the
		 * token); short-circuit so we don't pull in the route-params
		 * machinery.
		 */
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
	 * Collect non-default route params first so we can decide whether
	 * `style=standard` belongs in the URL at all. PHP's
	 * `route_params_from_attrs` returns an empty array when only the
	 * default `style` would be set; matching that here keeps editor and
	 * front-end URLs byte-identical (including for the token-only case,
	 * where both sides should produce `?token=…` without a stray
	 * `style=standard`).
	 */
	const nonDefaults: Array< [ string, string ] > = [];
	if ( ! showElevation ) {
		nonDefaults.push( [ 'hideElevation', 'true' ] );
	}
	if ( 'auto' !== units ) {
		nonDefaults.push( [ 'units', units ] );
	}
	if ( fullWidth ) {
		nonDefaults.push( [ 'fullWidth', 'true' ] );
	}
	if ( 'auto' !== terrain ) {
		nonDefaults.push( [ 'terrain', terrain ] );
	}
	if ( showDirt ) {
		nonDefaults.push( [ 'surfaceType', 'true' ] );
	}

	/*
	 * URLSearchParams preserves insertion order; PHP's `http_build_query`
	 * does too with `style` listed first by construction in
	 * `route_params_from_attrs`. Set `style` first when emitted, then
	 * the non-default params, then the token last — same order on both
	 * sides.
	 */
	const params = new URLSearchParams();
	if ( 'standard' !== mapStyle || nonDefaults.length > 0 ) {
		params.set( 'style', mapStyle );
	}
	for ( const [ key, value ] of nonDefaults ) {
		params.set( key, value );
	}
	if ( token ) {
		/*
		 * Routes won't 403 like tokenized activities do, but Strava
		 * accepts the param either way and the snippet path could carry
		 * one through for routes. Round-trip it so editor/server URLs
		 * match exactly.
		 */
		params.set( 'token', token );
	}

	const query = params.toString();
	return query ? `${ base }?${ query }` : base;
}

addFilter(
	'blocks.registerBlockType',
	'block-for-strava/route-attributes',
	( settings: BlockTypeSettings, name: string ): BlockTypeSettings => {
		if ( 'core/embed' !== name ) {
			return settings;
		}
		return {
			...settings,
			attributes: {
				...( settings.attributes ?? {} ),
				stravaRouteMapStyle: {
					type: 'string',
					default: 'standard',
					enum: ROUTE_MAP_STYLES,
				},
				stravaRouteTerrain: {
					type: 'string',
					default: 'auto',
					enum: ROUTE_TERRAINS,
				},
				stravaRouteUnits: {
					type: 'string',
					default: 'auto',
					enum: ROUTE_UNITS,
				},
				stravaRouteFullWidth: { type: 'boolean', default: false },
				stravaRouteShowDirt: { type: 'boolean', default: false },
				stravaRouteShowElevation: { type: 'boolean', default: true },
			},
		};
	}
);

/*
 * `clampEnum` is the same defense-in-depth pattern the legacy block used —
 * a hand-edited block comment can persist a string outside the enum, and
 * passing that to Strava's iframe URL would silently fall back to default
 * behavior. Reading attributes through this clamp keeps the inspector
 * controls in sync with what the renderer will accept.
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
 * rendered height via `BROADCAST_IFRAME_HEIGHT` shortly after load, but we
 * need *something* to show before that arrives — 730 is roughly the route-
 * with-elevation case (the tallest of the three). Activities and segments
 * shrink to ~405 once the broadcast lands; routes settle right around 730.
 */
const DEFAULT_PREVIEW_HEIGHT = 730;

/*
 * Sanity guards on the height we'll accept from a postMessage. Strava's
 * embeds never broadcast values anywhere near these extremes; the clamp is
 * defense-in-depth against a measurement glitch (or a hostile iframe peer)
 * driving the editor preview to 1px or 50000px.
 */
const MIN_PREVIEW_HEIGHT = 100;
const MAX_PREVIEW_HEIGHT = 5000;

/**
 * Decodes a `BROADCAST_IFRAME_HEIGHT` postMessage from `strava-embeds.com`,
 * returning the clamped pixel height to apply or `null` if the payload
 * isn't a recognized height broadcast.
 *
 * Strava's embed page posts `[id, 'BROADCAST_IFRAME_HEIGHT', height]` to
 * its parent window once layout settles. The previous custom-block
 * implementation listened for this through a srcdoc shim; the variation
 * embeds strava-embeds.com directly so the editor receives the broadcast
 * first-hand and we just need to decode it.
 *
 * Returning `null` for malformed payloads keeps the caller branch-free —
 * a height of `0` from a malformed message would otherwise be ambiguous
 * with "ignore this message."
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
 * Renders the Strava embed iframe directly inside the editor canvas, with
 * route options baked into the URL so toggling a control updates the
 * preview live. The figure/wrapper structure mirrors core/embed's `save()`
 * output so the surrounding editor styles, alignment, and selection chrome
 * still apply.
 *
 * Two editor-only behaviors layered on top of the bare iframe:
 * - `pointer-events: none` keeps clicks from sinking into the cross-origin
 *   strava-embeds.com document; without it, the figure (which holds the
 *   selection handlers `useBlockProps` returns) never sees the click and
 *   the user can no longer pick the block after a paste.
 * - A `BROADCAST_IFRAME_HEIGHT` listener resizes the iframe to whatever
 *   Strava's embed page reports it actually rendered at; otherwise activity
 *   and segment previews sit inside a 730px frame with ~325px of empty band
 *   below the visible content (730 is sized for routes + elevation).
 *
 * @param props Block edit props plus the URL-resolved {type, id}.
 */
export function StravaCustomEdit(
	props: BlockEditProps & { resolved: ResolvedStravaUrl; url: string }
) {
	const blockProps = useBlockProps( {
		className:
			'wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava',
	} );

	/*
	 * Preflight Strava's iframe URL on the user's behalf so we can warn
	 * before save when an activity URL alone won't render. Strava's
	 * per-activity share token isn't discoverable server-side (it's only
	 * minted into the share dialog for a logged-in browser session), so
	 * the only actionable signal we can give is "this URL paste won't
	 * work — paste the embed code from Strava's share dialog instead."
	 *
	 * That message is only correct for activities that 403 (the EEE
	 * "needs token" page). 404s, 5xxs, transport failures, and route /
	 * segment URLs share the same `embeddable: false` payload but
	 * shouldn't trigger the snippet notice — the snippet workaround
	 * doesn't apply to those cases. Treat anything other than
	 * `status === 403 && type === 'activity'` as `unknown` so the iframe
	 * just renders and the user sees Strava's actual response.
	 *
	 * Skip the fetch entirely when a token is already stored — the
	 * snippet-paste flow is the other source of one and its iframe is
	 * guaranteed to render.
	 */
	const { attributes, resolved } = props;
	/*
	 * Match `buildEmbedUrl`'s clamp: only treat a non-empty *string* as a
	 * stored token. Hand-edited block markup can persist arbitrary types
	 * for any attribute; `?? ''` would let a `false`/`0`/object slip
	 * through as truthy and skip the preflight while `buildEmbedUrl`
	 * normalized the same value to an empty token, suppressing the
	 * 403 notice for an iframe that's actually broken.
	 */
	const storedToken =
		typeof attributes.stravaEmbedToken === 'string'
			? attributes.stravaEmbedToken
			: '';
	const [ embedStatus, setEmbedStatus ] = useState<
		'unknown' | 'ok' | 'needs-token'
	>( 'unknown' );
	useEffect( () => {
		if ( '' !== storedToken ) {
			// Snippet-paste path already supplied a working token.
			setEmbedStatus( 'ok' );
			return;
		}
		setEmbedStatus( 'unknown' );
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
				if ( response?.embeddable ) {
					setEmbedStatus( 'ok' );
					return;
				}
				/*
				 * Only the activity-403 case has an actionable user
				 * recovery (paste the share-dialog snippet). Everything
				 * else stays `unknown`, the iframe renders, and the user
				 * sees Strava's real response — better than a notice
				 * giving advice that doesn't apply.
				 */
				if (
					'activity' === resolved.type &&
					403 === response?.status
				) {
					setEmbedStatus( 'needs-token' );
				}
			} )
			.catch( () => {
				/*
				 * Network failure is non-fatal: leave status as `unknown`
				 * so we don't surface a misleading notice over a transient
				 * blip. The iframe still renders; the user sees Strava's
				 * response directly.
				 */
			} );
		return () => {
			cancelled = true;
		};
	}, [ resolved.type, resolved.id, storedToken ] );

	const src = buildEmbedUrl( props.resolved, props.attributes );

	const iframeRef = useRef< HTMLIFrameElement | null >( null );
	const [ height, setHeight ] = useState( DEFAULT_PREVIEW_HEIGHT );

	/*
	 * URL-edit mode mirrors core/embed's pencil affordance: the toolbar
	 * button toggles between the iframe preview and a placeholder form
	 * pre-filled with the current URL. We have to roll our own because
	 * `editor.BlockEdit` swaps out core/embed's entire edit component (and
	 * with it, core's `EmbedControls` toolbar) once we resolve a canonical
	 * Strava URL. `urlInput` mirrors the saved attribute on entry so
	 * cancelling (re-clicking the pencil without submitting) leaves the
	 * stored URL untouched.
	 */
	const [ isEditingURL, setIsEditingURL ] = useState( false );
	const [ urlInput, setUrlInput ] = useState( props.url );

	const submitURL = ( event: FormEvent< HTMLFormElement > ) => {
		event.preventDefault();
		/*
		 * Trim before saving: `parseStravaUrl` anchors at `^https?` so a
		 * leading newline or space from a clipboard paste would silently
		 * fall through to core/embed and the saved attribute would carry
		 * the stray whitespace forward.
		 */
		props.setAttributes( { url: urlInput.trim() } );
		setIsEditingURL( false );
	};

	const toggleEditingURL = () => {
		setUrlInput( props.url );
		setIsEditingURL( ( prev ) => ! prev );
	};

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
		 * default document. Asserting both lets us keep the effect linear.
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
	const isRoute = 'route' === props.resolved.type;
	const fullWidth =
		isRoute && clampBool( props.attributes.stravaRouteFullWidth, false );

	return createElement(
		Fragment,
		null,
		createElement(
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
				} )
			)
		),
		isRoute && ! isEditingURL
			? createElement( StravaRouteInspector, props )
			: null,
		! isEditingURL && 'needs-token' === embedStatus
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
		isEditingURL
			? createElement(
					'figure',
					blockProps,
					createElement(
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
								onSubmit: submitURL,
							},
							createElement( 'input', {
								type: 'url',
								value: urlInput,
								className: 'components-placeholder__input',
								'aria-label': __(
									'Embed URL',
									'block-for-strava'
								),
								placeholder: __(
									'Enter URL to embed here…',
									'block-for-strava'
								),
								onChange: (
									event: ChangeEvent< HTMLInputElement >
								) => setUrlInput( event.target.value ),
							} ),
							createElement(
								Button,
								{
									variant: 'primary',
									type: 'submit',
								},
								__( 'Embed', 'block-for-strava' )
							)
						)
					)
			  )
			: createElement(
					'figure',
					blockProps,
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
								pointerEvents: 'none',
							},
						} )
					)
			  )
	);
}

/*
 * Override core/embed's preview only when we can resolve the URL into a
 * canonical {type, id} client-side. Short URLs (`strava.app.link/…`) and
 * empty URLs need core/embed's stock UI: short URLs require the server-
 * side resolver, and an empty URL needs the URL-prompt placeholder.
 */
addFilter(
	'editor.BlockEdit',
	'block-for-strava/route-controls',
	( BlockEdit: ComponentType< BlockEditProps > ) => {
		function StravaRouteEdit( props: BlockEditProps ) {
			const url = props.attributes.url ?? '';
			const resolved =
				'core/embed' === props.name &&
				'strava' === props.attributes.providerNameSlug
					? parseStravaUrl( url )
					: null;
			if ( null === resolved ) {
				return createElement( BlockEdit, props );
			}
			return createElement( StravaCustomEdit, {
				...props,
				resolved,
				url,
			} );
		}
		StravaRouteEdit.displayName = 'StravaRouteEdit';
		return StravaRouteEdit;
	}
);
