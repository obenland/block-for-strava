/**
 * Route-specific customization controls for the Strava embed variation.
 *
 * Block variations can't carry their own attributes or transforms, so we
 * extend `core/embed` itself with route-only attributes via the
 * `blocks.registerBlockType` filter and add the inspector panel through
 * `editor.BlockEdit`. The panel only appears when the variation is active
 * (`providerNameSlug === 'strava'`) AND the URL targets a route — Strava
 * exposes these knobs only for routes in their share dialog.
 *
 * Editor preview shows the default route styling because core/embed
 * caches the oEmbed proxy response per URL; the customizations land in
 * the published HTML via the PHP `render_block_core/embed` filter, which
 * appends Strava's documented query params to the iframe `src`.
 */
import { addFilter } from '@wordpress/hooks';
import { InspectorControls } from '@wordpress/block-editor';
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
 * Strict end-anchor variant of the variation's route pattern: the controls
 * panel should only surface when we're confident the URL is a route. The
 * variation patterns accept a prefix; here we require the digits to be
 * followed by a delimiter or end-of-string so partial matches don't trigger
 * a UI panel that wouldn't apply.
 */
const ROUTE_URL_RE =
	/^https?:\/\/(?:[a-z0-9-]+\.)*strava\.com\/routes\/\d+(?=[/?#]|$)/i;

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

function isStravaRouteBlock(
	name: string,
	attributes: StravaRouteAttributes
): boolean {
	return (
		'core/embed' === name &&
		'strava' === attributes.providerNameSlug &&
		ROUTE_URL_RE.test( attributes.url ?? '' )
	);
}

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

addFilter(
	'editor.BlockEdit',
	'block-for-strava/route-controls',
	( BlockEdit: ComponentType< BlockEditProps > ) => {
		function StravaRouteEdit( props: BlockEditProps ) {
			if ( ! isStravaRouteBlock( props.name, props.attributes ) ) {
				return createElement( BlockEdit, props );
			}
			return createElement(
				Fragment,
				null,
				createElement( BlockEdit, props ),
				createElement( StravaRouteInspector, props )
			);
		}
		StravaRouteEdit.displayName = 'StravaRouteEdit';
		return StravaRouteEdit;
	}
);
