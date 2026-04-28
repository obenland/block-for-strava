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

/*
 * Each part is space-prefixed so callers can concatenate directly. Returning
 * a single string (not an array) keeps interpolation into the iframe srcDoc
 * straightforward and avoids accidental whitespace differences between the
 * editor preview and the PHP render output.
 */
function buildRouteDataAttrs( attrs: RouteAttrs ): string {
	const parts: string[] = [ ` data-style="${ attrs.routeMapStyle }"` ];
	if ( ! attrs.routeShowElevation ) {
		parts.push( ' data-hide-elevation="true"' );
	}
	if ( attrs.routeUnits !== 'auto' ) {
		parts.push( ` data-units="${ attrs.routeUnits }"` );
	}
	if ( attrs.routeFullWidth ) {
		parts.push( ' data-full-width="true"' );
	}
	if ( attrs.routeTerrain !== 'auto' ) {
		parts.push( ` data-terrain="${ attrs.routeTerrain }"` );
	}
	if ( attrs.routeShowDirt ) {
		parts.push( ' data-surface-type="true"' );
	}
	return parts.join( '' );
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
			/*
			 * Defense in depth: the embedId is a UUID and effectively
			 * unguessable, but also require the message to originate from
			 * this block's own iframe so other frames on the page cannot
			 * spoof height updates even if they obtain the id.
			 */
			if ( event.source !== iframeRef.current?.contentWindow ) {
				return;
			}
			const data = event.data;
			if (
				data &&
				typeof data === 'object' &&
				data.stravaEmbedId === embedId &&
				Number.isFinite( data.stravaEmbedHeight )
			) {
				const next = Math.min(
					Math.max( data.stravaEmbedHeight, MIN_HEIGHT ),
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

	/*
	 * Clamp before interpolating into the iframe HTML. The block.json enum
	 * and TypeScript types should keep these in shape, but a hand-edited
	 * post could persist arbitrary values, and the iframe runs with
	 * allow-same-origin (see sandbox comment below), so this clamping is a
	 * primary boundary against injecting attribute strings into the srcdoc.
	 */
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

	/*
	 * For routes, expose the user-chosen options as data-* attrs that
	 * Strava's embed.js spreads onto the inner iframe URL as query params.
	 * Activities and segments keep the original "standard" style — those
	 * embed types don't have these knobs in Strava's share dialog.
	 */
	const routeDataAttrs =
		safeEmbedType === 'route'
			? buildRouteDataAttrs( {
					routeShowElevation: safeRouteShowElevation,
					routeUnits: safeRouteUnits,
					routeFullWidth: safeRouteFullWidth,
					routeMapStyle: safeRouteMapStyle,
					routeTerrain: safeRouteTerrain,
					routeShowDirt: safeRouteShowDirt,
			  } )
			: ' data-style="standard"';

	const iframeSrcDoc = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;}</style></head><body><div class="strava-embed-placeholder" data-embed-type="${ safeEmbedType }" data-embed-id="${ safeActivityId }"${ routeDataAttrs }></div><script src="https://strava-embeds.com/embed.js"></script><script>(function(){var n="${ embedId }";function send(h){window.parent.postMessage({stravaEmbedId:n,stravaEmbedHeight:h},"*");}window.addEventListener("message",function(e){if(Array.isArray(e.data)&&e.data[1]==="BROADCAST_IFRAME_HEIGHT"){send(e.data[2]||${ DEFAULT_HEIGHT });}});})();</script></body></html>`;

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
							srcDoc={ iframeSrcDoc }
							style={ {
								width: '100%',
								height: `${ previewHeight }px`,
								border: 'none',
								display: 'block',
							} }
							scrolling="no"
							/*
							 * allow-same-origin is required for route embeds:
							 * sandbox flags inherit into the nested
							 * strava-embeds.com iframe, and without
							 * allow-same-origin its requests for map-style
							 * JSON go out as origin "null", which Strava's
							 * CORS rejects (Access-Control-Allow-Origin: *
							 * vs. credentialed fetch). With both flags the
							 * embed gets its real origin and the map renders.
							 * The frontend already loads embed.js unsandboxed,
							 * so the editor isn't a tighter trust boundary.
							 */
							sandbox="allow-scripts allow-same-origin"
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
