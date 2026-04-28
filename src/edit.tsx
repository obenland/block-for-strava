import './editor.scss';
import {
	useState,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from '@wordpress/element';
import {
	useBlockProps,
	BlockControls,
	BlockIcon,
	InspectorControls,
	RichText,
} from '@wordpress/block-editor';
import {
	Placeholder,
	PanelBody,
	RadioControl,
	SelectControl,
	TextControl,
	ToggleControl,
	Button,
	Spinner,
	Disabled,
	ToolbarGroup,
	ToolbarButton,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	pencil as pencilIcon,
	chartBar as activityIcon,
} from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';

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

interface Attributes {
	url: string;
	activityId: string;
	embedType: EmbedType;
	caption: string;
	routeShowElevation: boolean;
	routeUnits: RouteUnits;
	routeFullWidth: boolean;
	routeMapStyle: RouteMapStyle;
	routeTerrain: RouteTerrain;
	routeShowDirt: boolean;
}

const ROUTE_UNITS: ReadonlyArray< RouteUnits > = [
	'auto',
	'metric',
	'imperial',
];
const ROUTE_MAP_STYLES: ReadonlyArray< RouteMapStyle > = [
	'standard',
	'satellite',
	'hybrid',
	'dark',
	'winter',
	'light',
];
const ROUTE_TERRAINS: ReadonlyArray< RouteTerrain > = [ 'auto', '2d', '3d' ];

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

/*
 * A hand-edited block comment can persist boolean attributes as strings
 * ("false" is valid JSON but not a boolean), and `if ("false") {}` is truthy
 * in JS — the same defense-in-depth pattern as `clampEnum`. Reject anything
 * that isn't a real boolean and use the block.json default instead.
 */
function clampBool( value: unknown, fallback: boolean ): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

interface EditProps {
	attributes: Attributes;
	setAttributes: ( attrs: Partial< Attributes > ) => void;
	isSelected: boolean;
}

interface ResolveResponse {
	activityId: string;
	embedType?: EmbedType;
}

const URL_PATH_TO_TYPE: Record< string, EmbedType > = {
	activities: 'activity',
	routes: 'route',
	segments: 'segment',
};

const DEFAULT_HEIGHT = 730;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 5000;

/*
 * crypto.randomUUID is available in all WP-supported browsers in secure
 * contexts, but fall back to a random string if it's missing so the Edit
 * component never throws at render time.
 */
function generateEmbedId(): string {
	if ( typeof crypto !== 'undefined' && crypto.randomUUID ) {
		return crypto.randomUUID();
	}
	return `bfs-${ Date.now().toString( 36 ) }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }`;
}

function parseStravaUrl(
	url: string
): { activityId: string; embedType: EmbedType } | null {
	let parsed: URL;
	try {
		parsed = new URL( url );
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	if ( host !== 'strava.com' && ! host.endsWith( '.strava.com' ) ) {
		return null;
	}

	const match = parsed.pathname.match(
		/^\/(activities|routes|segments)\/(\d+)(?:\/|$)/i
	);
	if ( ! match ) {
		return null;
	}
	return {
		activityId: match[ 2 ],
		embedType: URL_PATH_TO_TYPE[ match[ 1 ].toLowerCase() ],
	};
}

function parseEmbedCode(
	input: string
): { activityId: string; embedType: EmbedType } | null {
	const idMatch = input.match( /data-embed-id="(\d+)"/ );
	if ( ! idMatch ) {
		return null;
	}
	const typeMatch = input.match(
		/data-embed-type="(activity|route|segment)"/i
	);
	return {
		activityId: idMatch[ 1 ],
		embedType: typeMatch
			? ( typeMatch[ 1 ].toLowerCase() as EmbedType )
			: 'activity',
	};
}

function isShortUrl( url: string ): boolean {
	return /strava\.app\.link/i.test( url );
}

interface RouteAttrs {
	routeShowElevation: boolean;
	routeUnits: RouteUnits;
	routeFullWidth: boolean;
	routeMapStyle: RouteMapStyle;
	routeTerrain: RouteTerrain;
	routeShowDirt: boolean;
}

// Param names mirror what embed.js produces from `data-foo-bar` dataset keys.
function buildEmbedQuery( routeOpts: RouteAttrs | null ): URLSearchParams {
	const query = new URLSearchParams();
	if ( ! routeOpts ) {
		query.set( 'style', 'standard' );
		return query;
	}
	query.set( 'style', routeOpts.routeMapStyle );
	if ( ! routeOpts.routeShowElevation ) {
		query.set( 'hideElevation', 'true' );
	}
	if ( routeOpts.routeUnits !== 'auto' ) {
		query.set( 'units', routeOpts.routeUnits );
	}
	if ( routeOpts.routeFullWidth ) {
		query.set( 'fullWidth', 'true' );
	}
	if ( routeOpts.routeTerrain !== 'auto' ) {
		query.set( 'terrain', routeOpts.routeTerrain );
	}
	if ( routeOpts.routeShowDirt ) {
		query.set( 'surfaceType', 'true' );
	}
	return query;
}

// `ns` is the prefix in the [ns, event, args] postMessage envelope.
// hostPath/hostTitle would leak the draft post URL and title into the iframe.
function buildEmbedHash( namespace: string ): URLSearchParams {
	return new URLSearchParams( {
		ns: namespace,
		hostOrigin: window.location.origin,
	} );
}

function buildStravaEmbedUrl(
	embedType: EmbedType,
	resourceId: string,
	routeOpts: RouteAttrs | null,
	namespace: string
): string {
	const query = buildEmbedQuery( routeOpts );
	const hash = buildEmbedHash( namespace );
	return `https://strava-embeds.com/${ embedType }/${ resourceId }?${ query.toString() }#${ hash.toString() }`;
}

export default function Edit( {
	attributes,
	setAttributes,
	isSelected,
}: EditProps ) {
	const {
		activityId,
		embedType,
		caption,
		routeShowElevation,
		routeUnits,
		routeFullWidth,
		routeMapStyle,
		routeTerrain,
		routeShowDirt,
	} = attributes;
	const blockProps = useBlockProps();

	const [ inputUrl, setInputUrl ] = useState( '' );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );
	const [ isEditing, setIsEditing ] = useState( ! activityId );
	const [ previewHeight, setPreviewHeight ] = useState( DEFAULT_HEIGHT );
	const iframeRef = useRef< HTMLIFrameElement >( null );

	/*
	 * Match core block conventions (image, video, embed): when the caption
	 * RichText mounts and is still empty, move focus into it so the user can
	 * start typing immediately. Skip the focus once content exists so we
	 * don't steal focus on every re-render.
	 */
	const captionRef = useCallback(
		( node: HTMLElement | null ) => {
			if ( node && ! caption ) {
				node.focus();
			}
		},
		[ caption ]
	);

	/*
	 * The embedId must be unguessable so the postMessage handler can verify
	 * a height update came from this block's own iframe and not another
	 * frame on the page that happened to learn the id. Listing activityId
	 * and embedType as deps — even though neither is read inside the callback
	 * — forces a fresh random id (and a remount) whenever the embedded
	 * resource changes, so a stale id from a previous embed can't be replayed
	 * against the new one. Both are needed because activityId is unique per
	 * embed type, not globally — an activity and a route can share an id.
	 */
	const embedId = useMemo(
		() => generateEmbedId(),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[ activityId, embedType ]
	);

	/*
	 * Each new iframe should start at the default height. Without this reset,
	 * a tall previous embed could leave the height stuck if the relay message
	 * for the new activity is delayed, blocked, or never arrives.
	 */
	useEffect( () => {
		setPreviewHeight( DEFAULT_HEIGHT );
	}, [ embedId ] );

	useEffect( () => {
		const handler = ( event: MessageEvent ) => {
			// Verify source window too: ns is public over postMessage.
			if ( event.source !== iframeRef.current?.contentWindow ) {
				return;
			}
			const data = event.data;
			if (
				Array.isArray( data ) &&
				data[ 0 ] === embedId &&
				data[ 1 ] === 'BROADCAST_IFRAME_HEIGHT' &&
				Number.isFinite( data[ 2 ] )
			) {
				const next = Math.min(
					Math.max( data[ 2 ] as number, MIN_HEIGHT ),
					MAX_HEIGHT
				);
				setPreviewHeight( next );
			}
		};
		window.addEventListener( 'message', handler );
		return () => window.removeEventListener( 'message', handler );
	}, [ embedId ] );

	const handleSubmit = useCallback( async () => {
		setError( null );
		const trimmed = inputUrl.trim();

		if ( ! trimmed ) {
			setError( __( 'Please enter a URL.', 'block-for-strava' ) );
			return;
		}

		const embedData = parseEmbedCode( trimmed );
		if ( embedData ) {
			setAttributes( {
				url: trimmed,
				activityId: embedData.activityId,
				embedType: embedData.embedType,
			} );
			setIsEditing( false );
			return;
		}

		const parsed = parseStravaUrl( trimmed );
		if ( parsed ) {
			setAttributes( {
				url: trimmed,
				activityId: parsed.activityId,
				embedType: parsed.embedType,
			} );
			setIsEditing( false );
			return;
		}

		if ( isShortUrl( trimmed ) ) {
			setIsLoading( true );
			try {
				const response = await apiFetch< ResolveResponse >( {
					path: `/block-for-strava/v1/resolve?url=${ encodeURIComponent(
						trimmed
					) }`,
				} );
				setAttributes( {
					url: trimmed,
					activityId: response.activityId,
					embedType: response.embedType ?? 'activity',
				} );
				setIsEditing( false );
			} catch ( err ) {
				const message =
					err instanceof Error
						? err.message
						: __( 'Could not resolve URL.', 'block-for-strava' );
				setError( message );
			} finally {
				setIsLoading( false );
			}
			return;
		}

		setError(
			__(
				'Please enter a valid Strava activity, route, or segment URL.',
				'block-for-strava'
			)
		);
	}, [ inputUrl, setAttributes ] );

	// Clamp before the values become path segments in the iframe URL.
	const safeEmbedType: EmbedType =
		embedType === 'route' || embedType === 'segment'
			? embedType
			: 'activity';
	const safeActivityId = /^\d+$/.test( activityId ) ? activityId : '';

	/*
	 * Clamp persisted attribute values once, then feed the same safe values to
	 * both the sidebar controls and the iframe serialization. Without this, a
	 * hand-edited post with an invalid value would render the sidebar in one
	 * state while the preview/front-end silently fell back to another —
	 * visually misleading and confusing to fix.
	 */
	const safeRouteUnits = clampEnum( routeUnits, ROUTE_UNITS, 'auto' );
	const safeRouteMapStyle = clampEnum(
		routeMapStyle,
		ROUTE_MAP_STYLES,
		'standard'
	);
	const safeRouteTerrain = clampEnum( routeTerrain, ROUTE_TERRAINS, 'auto' );
	const safeRouteShowElevation = clampBool( routeShowElevation, true );
	const safeRouteFullWidth = clampBool( routeFullWidth, false );
	const safeRouteShowDirt = clampBool( routeShowDirt, false );

	// Activities and segments don't have these knobs in Strava's share dialog.
	const stravaEmbedUrl = buildStravaEmbedUrl(
		safeEmbedType,
		safeActivityId,
		safeEmbedType === 'route'
			? {
					routeShowElevation: safeRouteShowElevation,
					routeUnits: safeRouteUnits,
					routeFullWidth: safeRouteFullWidth,
					routeMapStyle: safeRouteMapStyle,
					routeTerrain: safeRouteTerrain,
					routeShowDirt: safeRouteShowDirt,
			  }
			: null,
		embedId
	);

	return (
		<>
			{ ! isEditing && (
				<BlockControls>
					<ToolbarGroup>
						<ToolbarButton
							icon={ pencilIcon }
							label={ __( 'Replace', 'block-for-strava' ) }
							onClick={ () => {
								setInputUrl( '' );
								setError( null );
								setIsEditing( true );
							} }
						/>
					</ToolbarGroup>
				</BlockControls>
			) }

			{ ! isEditing && safeEmbedType === 'route' && (
				<InspectorControls>
					<PanelBody
						title={ __( 'Route options', 'block-for-strava' ) }
						initialOpen
					>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Show elevation profile',
								'block-for-strava'
							) }
							checked={ safeRouteShowElevation }
							onChange={ ( value: boolean ) =>
								setAttributes( { routeShowElevation: value } )
							}
						/>
						<RadioControl
							label={ __( 'Units', 'block-for-strava' ) }
							help={ __(
								'Auto picks units based on the viewer’s location.',
								'block-for-strava'
							) }
							selected={ safeRouteUnits }
							options={ [
								{
									label: __( 'Auto', 'block-for-strava' ),
									value: 'auto',
								},
								{
									label: __( 'Metric', 'block-for-strava' ),
									value: 'metric',
								},
								{
									label: __( 'Imperial', 'block-for-strava' ),
									value: 'imperial',
								},
							] }
							onChange={ ( value: string ) =>
								setAttributes( {
									routeUnits: clampEnum(
										value,
										ROUTE_UNITS,
										'auto'
									),
								} )
							}
						/>
						<RadioControl
							label={ __( 'Embed width', 'block-for-strava' ) }
							help={ __(
								'Responsive embeds expand to fill available space.',
								'block-for-strava'
							) }
							selected={
								safeRouteFullWidth ? 'responsive' : 'fixed'
							}
							options={ [
								{
									label: __( 'Fixed', 'block-for-strava' ),
									value: 'fixed',
								},
								{
									label: __(
										'Responsive',
										'block-for-strava'
									),
									value: 'responsive',
								},
							] }
							onChange={ ( value: string ) =>
								setAttributes( {
									routeFullWidth: value === 'responsive',
								} )
							}
						/>
						<SelectControl
							__nextHasNoMarginBottom
							label={ __( 'Map style', 'block-for-strava' ) }
							value={ safeRouteMapStyle }
							options={ [
								{
									label: __( 'Standard', 'block-for-strava' ),
									value: 'standard',
								},
								{
									label: __(
										'Satellite',
										'block-for-strava'
									),
									value: 'satellite',
								},
								{
									label: __( 'Hybrid', 'block-for-strava' ),
									value: 'hybrid',
								},
								{
									label: __( 'Dark', 'block-for-strava' ),
									value: 'dark',
								},
								{
									label: __( 'Winter', 'block-for-strava' ),
									value: 'winter',
								},
								{
									label: __( 'Light', 'block-for-strava' ),
									value: 'light',
								},
							] }
							onChange={ ( value: string ) =>
								setAttributes( {
									routeMapStyle: clampEnum(
										value,
										ROUTE_MAP_STYLES,
										'standard'
									),
								} )
							}
						/>
						<RadioControl
							label={ __( 'Terrain', 'block-for-strava' ) }
							selected={ safeRouteTerrain }
							options={ [
								{
									label: __( 'Auto', 'block-for-strava' ),
									value: 'auto',
								},
								{
									label: __( '2D', 'block-for-strava' ),
									value: '2d',
								},
								{
									label: __( '3D', 'block-for-strava' ),
									value: '3d',
								},
							] }
							onChange={ ( value: string ) =>
								setAttributes( {
									routeTerrain: clampEnum(
										value,
										ROUTE_TERRAINS,
										'auto'
									),
								} )
							}
						/>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Highlight unpaved surfaces',
								'block-for-strava'
							) }
							checked={ safeRouteShowDirt }
							onChange={ ( value: boolean ) =>
								setAttributes( { routeShowDirt: value } )
							}
						/>
					</PanelBody>
				</InspectorControls>
			) }

			{ isEditing ? (
				<div { ...blockProps }>
					<Placeholder
						icon={ <BlockIcon icon={ activityIcon } showColors /> }
						label={ __( 'Strava Activity', 'block-for-strava' ) }
						instructions={ __(
							'Paste a Strava activity URL or the embed code from the Strava share dialog.',
							'block-for-strava'
						) }
					>
						<form
							aria-busy={ isLoading }
							onSubmit={ ( e ) => {
								e.preventDefault();
								void handleSubmit();
							} }
						>
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								className="block-for-strava__url-input"
								label={ __(
									'Activity URL',
									'block-for-strava'
								) }
								hideLabelFromVision
								placeholder={ __(
									'https://www.strava.com/activities/…',
									'block-for-strava'
								) }
								value={ inputUrl }
								onChange={ setInputUrl }
								disabled={ isLoading }
							/>
							{ isLoading ? (
								<Spinner />
							) : (
								<Button
									__next40pxDefaultSize
									variant="primary"
									type="submit"
								>
									{ __( 'Embed', 'block-for-strava' ) }
								</Button>
							) }
						</form>
						{ error && (
							<p role="alert" className="block-for-strava__error">
								{ error }
							</p>
						) }
					</Placeholder>
				</div>
			) : (
				<figure { ...blockProps }>
					<Disabled>
						<iframe
							key={ embedId }
							ref={ iframeRef }
							src={ stravaEmbedUrl }
							style={ {
								width: '100%',
								height: `${ previewHeight }px`,
								border: 'none',
								display: 'block',
							} }
							scrolling="no"
							// Block top navigation and forms; allow popups and let them open as normal Strava tabs.
							sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
							// Don't leak the wp-admin URL to Strava via Referer.
							referrerPolicy="origin"
							title={ __(
								'Strava Activity',
								'block-for-strava'
							) }
						/>
					</Disabled>
					{ ( isSelected || caption ) && (
						<RichText
							identifier="caption"
							tagName="figcaption"
							className="wp-element-caption"
							ref={ captionRef }
							aria-label={ __(
								'Strava activity caption text',
								'block-for-strava'
							) }
							placeholder={ __(
								'Add caption',
								'block-for-strava'
							) }
							value={ caption }
							onChange={ ( value: string ) =>
								setAttributes( { caption: value } )
							}
							inlineToolbar
						/>
					) }
				</figure>
			) }
		</>
	);
}
