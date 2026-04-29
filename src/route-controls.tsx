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
	if ( 'route' !== resolved.type ) {
		return base;
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
	 *
	 * Track non-default additions in an explicit counter rather than
	 * reading `URLSearchParams.size`. Mainstream browsers ship `.size`
	 * today, but the property is recent (2022–23) and an integer
	 * counter is one less compatibility footgun for old environments.
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
		return base;
	}
	return `${ base }?${ params.toString() }`;
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
		props.setAttributes( { url: urlInput } );
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
		window.addEventListener( 'message', handler );
		return () => window.removeEventListener( 'message', handler );
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
