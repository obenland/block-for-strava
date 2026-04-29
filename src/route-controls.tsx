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
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	ToggleControl,
	RadioControl,
	SelectControl,
} from '@wordpress/components';
import {
	Fragment,
	createElement,
	type ComponentType,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';

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

	const params = new URLSearchParams();
	if ( 'standard' !== mapStyle ) {
		params.set( 'style', mapStyle );
	}
	if ( ! showElevation ) {
		params.set( 'hideElevation', 'true' );
	}
	if ( 'auto' !== units ) {
		params.set( 'units', units );
	}
	if ( fullWidth ) {
		params.set( 'fullWidth', 'true' );
	}
	if ( 'auto' !== terrain ) {
		params.set( 'terrain', terrain );
	}
	if ( showDirt ) {
		params.set( 'surfaceType', 'true' );
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

/**
 * Renders the Strava embed iframe directly inside the editor canvas, with
 * route options baked into the URL so toggling a control updates the
 * preview live. The figure/wrapper structure mirrors core/embed's `save()`
 * output so the surrounding editor styles, alignment, and selection chrome
 * still apply.
 * @param props
 */
export function StravaCustomEdit(
	props: BlockEditProps & { resolved: ResolvedStravaUrl }
) {
	const blockProps = useBlockProps( {
		className:
			'wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava',
	} );
	const src = buildEmbedUrl( props.resolved, props.attributes );
	return createElement(
		Fragment,
		null,
		'route' === props.resolved.type
			? createElement( StravaRouteInspector, props )
			: null,
		createElement(
			'figure',
			blockProps,
			createElement(
				'div',
				{ className: 'wp-block-embed__wrapper' },
				createElement( 'iframe', {
					className: 'strava-embed-iframe',
					src,
					sandbox:
						'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
					referrerPolicy: 'origin',
					scrolling: 'no',
					title: __( 'Strava embed', 'block-for-strava' ),
					style: {
						width: '100%',
						height: '730px',
						border: 0,
						display: 'block',
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
			const resolved =
				'core/embed' === props.name &&
				'strava' === props.attributes.providerNameSlug
					? parseStravaUrl( props.attributes.url ?? '' )
					: null;
			if ( null === resolved ) {
				return createElement( BlockEdit, props );
			}
			return createElement( StravaCustomEdit, { ...props, resolved } );
		}
		StravaRouteEdit.displayName = 'StravaRouteEdit';
		return StravaRouteEdit;
	}
);
