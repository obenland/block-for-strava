<?php
/**
 * Strava oEmbed hijack.
 *
 * Strava does not publish an oEmbed endpoint, but the share dialog ships an
 * iframe-friendly embed page. This class makes Strava URLs behave like a
 * first-class embed provider so a pasted URL flows through the standard
 * `core/embed` pipeline (paste detection, preview, caching, render) without
 * requiring our custom block.
 *
 * Three integration points: `pre_oembed_result` short-circuits
 * `wp_oembed_get()`, `rest_request_after_callbacks` rewrites the editor's
 * `/oembed/1.0/proxy` response, and `wp_embed_register_handler()` covers
 * autoembed inside post_content. Pattern is borrowed from the ActivityPub
 * plugin's `Embed` class.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Hijacks oEmbed lookups for Strava URLs and returns an iframe pointing at
 * Strava's embed page.
 */
class Block_For_Strava_Embed {

	/**
	 * Default iframe width in pixels.
	 *
	 * @var int
	 */
	private const DEFAULT_WIDTH = 600;

	/**
	 * Default iframe height in pixels.
	 *
	 * @var int
	 */
	private const DEFAULT_HEIGHT = 730;

	/**
	 * Registers the filters/handlers that intercept Strava URL embeds.
	 */
	public static function init(): void {
		add_filter( 'pre_oembed_result', array( self::class, 'maybe_strava_embed' ), 10, 3 );
		add_filter( 'rest_request_after_callbacks', array( self::class, 'rest_proxy_fallback' ), 10, 3 );
		add_filter( 'render_block_core/embed', array( self::class, 'render_strava_embed' ), 10, 2 );
		add_action( 'rest_api_init', array( self::class, 'register_rest_routes' ) );

		/*
		 * Subdomain group matches the host check in `parse_strava_url()`
		 * (any `*.strava.com`). The trailing `(?:[/?#]|$)` rejects
		 * `/activities/123abc` so the digits can't greedily match an
		 * unrelated path. Pattern uses `~` as the delimiter so the `#`
		 * inside the character class is unescaped. Priority < 10 so we
		 * beat any generic handler a theme might add.
		 */
		wp_embed_register_handler(
			'block-for-strava-canonical',
			'~https?://(?:[a-z0-9-]+\.)*strava\.com/(?:activities|routes|segments)/\d+(?:[/?#]|$)~i',
			array( self::class, 'embed_handler' ),
			5
		);
		wp_embed_register_handler(
			'block-for-strava-short',
			'#https?://strava\.app\.link/[^\s]+#i',
			array( self::class, 'embed_handler' ),
			5
		);
	}

	/**
	 * Short-circuits `wp_oembed_get()` for Strava URLs.
	 *
	 * Returns null for non-Strava URLs so WordPress continues normal oEmbed
	 * processing. Returning a string here bypasses the entire provider lookup
	 * and the `oembed_result` sanitization filter chain — the iframe we hand
	 * back is already a safe, sandboxed wrapper.
	 *
	 * @param  null|string $result The pre-resolved oEmbed HTML (or null).
	 * @param  string      $url    The URL being embedded.
	 * @param  array       $args   Additional arguments from `wp_oembed_get`.
	 * @return null|string         Strava embed HTML, or null to fall through.
	 */
	public static function maybe_strava_embed( $result, $url, $args ) {
		if ( null !== $result || ! self::is_strava_host( $url ) ) {
			return $result;
		}

		$resolved = self::resolve_to_canonical( $url );
		if ( null === $resolved ) {
			return null;
		}

		// `wp_oembed_get` may pass 0 or non-numeric width/height; treat those
		// as "no preference" so `build_iframe` falls back to its defaults
		// instead of rendering `width="0"`.
		$width  = isset( $args['width'] ) ? (int) $args['width'] : 0;
		$height = isset( $args['height'] ) ? (int) $args['height'] : 0;

		return self::build_iframe(
			$resolved['type'],
			$resolved['id'],
			$width > 0 ? $width : null,
			$height > 0 ? $height : null
		);
	}

	/**
	 * Rewrites the `/oembed/1.0/proxy` REST response so the editor sees a
	 * proper Strava-branded oEmbed payload.
	 *
	 * Core's proxy endpoint already falls back to `wp_embed_register_handler`
	 * callbacks when no oEmbed provider matches — and that's where our
	 * iframe HTML comes from. The fallback response is generically branded
	 * `provider_name: 'Embed Handler'` and lacks a `type`, which the embed
	 * block surfaces verbatim. We rebrand here, and synthesize from scratch
	 * only if our handler somehow failed (defense-in-depth — the user's
	 * paste flow shouldn't dead-end with a 404 because of a registration
	 * ordering glitch).
	 *
	 * @param  mixed           $response Callback result (WP_REST_Response, WP_Error, or stdClass).
	 * @param  array           $handler  Route handler matched.
	 * @param  WP_REST_Request $request  Incoming request.
	 * @return mixed                     Possibly-rewritten response.
	 */
	public static function rest_proxy_fallback( $response, $handler, $request ) {
		if ( '/oembed/1.0/proxy' !== $request->get_route() ) {
			return $response;
		}

		$url = (string) $request->get_param( 'url' );
		if ( ! self::is_strava_host( $url ) ) {
			return $response;
		}

		$resolved = self::resolve_to_canonical( $url );
		if ( null === $resolved ) {
			return $response;
		}

		/*
		 * Only synthesize for oembed-lookup failures — other WP_Errors that
		 * make it this far (rest_cookie_invalid_nonce, rest_forbidden, etc.)
		 * must propagate untouched so the editor can react to auth state.
		 */
		if ( is_wp_error( $response ) ) {
			if ( 'oembed_invalid_url' === $response->get_error_code() ) {
				return self::build_payload( $resolved['type'], $resolved['id'] );
			}
			return $response;
		}

		$payload = $response instanceof WP_REST_Response ? $response->get_data() : $response;
		if ( ! is_object( $payload ) || empty( $payload->html ) ) {
			return self::build_payload( $resolved['type'], $resolved['id'] );
		}

		$payload->provider_name = 'Strava';
		$payload->provider_url  = 'https://www.strava.com/';
		$payload->type          = $payload->type ?? 'rich';

		if ( $response instanceof WP_REST_Response ) {
			$response->set_data( $payload );
			return $response;
		}
		return $payload;
	}

	/**
	 * Replaces a Strava core/embed block's wrapper contents with our iframe.
	 *
	 * Core/embed's `save()` writes a bare URL inside `<div class="wp-block-
	 * embed__wrapper">`; the URL gets turned into an iframe later by
	 * `WP_Embed::autoembed` running on `the_content`. Hooking earlier here
	 * lets us bake route-specific URL params directly into the iframe `src`
	 * (block attributes aren't visible to autoembed/oEmbed callbacks) and
	 * removes the autoembed pass for these blocks entirely — autoembed
	 * still owns bare URLs in plain post content.
	 *
	 * For activities and segments the resulting iframe is identical to what
	 * autoembed would have produced, so the rewrite is a clean no-op even
	 * when no route options are set.
	 *
	 * @param  string $block_content The original rendered block HTML.
	 * @param  array  $block         Parsed block (including attrs).
	 * @return string                Possibly-rewritten HTML.
	 */
	public static function render_strava_embed( string $block_content, array $block ): string {
		$attrs = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();
		if ( ( $attrs['providerNameSlug'] ?? '' ) !== 'strava' ) {
			return $block_content;
		}
		$resolved = self::resolve_to_canonical( (string) ( $attrs['url'] ?? '' ) );
		if ( null === $resolved ) {
			return $block_content;
		}

		$params = 'route' === $resolved['type']
			? self::route_params_from_attrs( $attrs )
			: array();

		/*
		 * Tokenized activities (anything not visibility=Everyone) 403 from
		 * strava-embeds.com without a `?token=…`. The token only enters
		 * the system via the snippet-paste path (`src/snippet-transform`)
		 * — Strava doesn't surface it in the unauthenticated activity HTML,
		 * so there's no server-side path to discover one for a URL-only
		 * paste. When the attribute is empty, fall through to the URL-only
		 * iframe shape: it works for public-Everyone activities and renders
		 * Strava's "Error code: EEE" page for restricted ones (which the
		 * editor's preflight surfaces as a notice before the post is saved).
		 */
		$token = isset( $attrs['stravaEmbedToken'] ) ? (string) $attrs['stravaEmbedToken'] : '';
		if ( '' !== $token ) {
			$params['token'] = $token;
		}

		$iframe = self::build_iframe( $resolved['type'], $resolved['id'], null, null, $params );

		/*
		 * Wrapper inner content is the bare URL after `save()`; replace it
		 * with our iframe in one shot. The non-greedy `.*?` plus `s` flag
		 * is safe because core/embed doesn't nest other elements inside the
		 * wrapper.
		 */
		$replaced = preg_replace(
			'~(<div[^>]*\bclass="[^"]*wp-block-embed__wrapper[^"]*"[^>]*>).*?(</div>)~is',
			'${1}' . $iframe . '${2}',
			$block_content,
			1
		);
		return null === $replaced ? $block_content : $replaced;
	}

	/**
	 * Extracts the Strava route URL params from a block's attributes.
	 *
	 * `style` is included unless it would be the only param and still set
	 * to its default `standard` value; the rest are only emitted when the
	 * user has chosen a non-default value, so Strava's iframe falls back
	 * to its own defaults for anything we don't override. Returning an
	 * empty array when nothing is customized keeps the iframe URL stable
	 * (and cache-friendly) for routes that haven't been tweaked.
	 *
	 * @param  array $attrs Block attributes.
	 * @return array        Param map suitable for `http_build_query`.
	 */
	private static function route_params_from_attrs( array $attrs ): array {
		$map_style = $attrs['stravaRouteMapStyle'] ?? 'standard';
		if ( ! in_array( $map_style, array( 'standard', 'satellite', 'hybrid', 'dark', 'winter', 'light' ), true ) ) {
			$map_style = 'standard';
		}
		$params = array( 'style' => $map_style );

		if ( isset( $attrs['stravaRouteShowElevation'] ) && false === $attrs['stravaRouteShowElevation'] ) {
			$params['hideElevation'] = 'true';
		}
		$units = $attrs['stravaRouteUnits'] ?? 'auto';
		if ( in_array( $units, array( 'metric', 'imperial' ), true ) ) {
			$params['units'] = $units;
		}
		// Strict `=== true` (rather than `! empty()`) mirrors the editor-
		// side `clampBool`: a hand-edited block comment storing the string
		// "false" is truthy in PHP and would otherwise silently flip these
		// flags on, diverging from what the editor actually shows.
		if ( isset( $attrs['stravaRouteFullWidth'] ) && true === $attrs['stravaRouteFullWidth'] ) {
			$params['fullWidth'] = 'true';
		}
		$terrain = $attrs['stravaRouteTerrain'] ?? 'auto';
		if ( in_array( $terrain, array( '2d', '3d' ), true ) ) {
			$params['terrain'] = $terrain;
		}
		if ( isset( $attrs['stravaRouteShowDirt'] ) && true === $attrs['stravaRouteShowDirt'] ) {
			$params['surfaceType'] = 'true';
		}

		// Drop the always-on `style` if it's the default and nothing else is
		// set — the default URL has no params, so we leave it that way.
		if ( count( $params ) === 1 && 'standard' === $params['style'] ) {
			return array();
		}
		return $params;
	}

	/**
	 * Builds a Strava-branded `/oembed/1.0/proxy` response payload.
	 *
	 * @param  string $embed_type  Singular embed type.
	 * @param  string $activity_id Numeric Strava ID.
	 * @return stdClass
	 */
	private static function build_payload( string $embed_type, string $activity_id ): stdClass {
		return (object) array(
			'provider_name' => 'Strava',
			'provider_url'  => 'https://www.strava.com/',
			'html'          => self::build_iframe( $embed_type, $activity_id ),
			'type'          => 'rich',
			'scripts'       => array(),
		);
	}

	/**
	 * `wp_embed_register_handler` callback for Strava URLs.
	 *
	 * Both canonical paths and `strava.app.link` short URLs route through
	 * `resolve_to_canonical` so the regex stays the only host gate. Returns
	 * false on resolution failure so `WP_Embed::shortcode()` falls through
	 * to leaving the URL bare (the autoembed contract).
	 *
	 * @param  array $matches The regex match groups (full URL in [0]).
	 * @return string|false   Iframe HTML, or false to fall through.
	 */
	public static function embed_handler( $matches ) {
		$resolved = self::resolve_to_canonical( (string) ( $matches[0] ?? '' ) );
		if ( null === $resolved ) {
			return false;
		}
		return self::build_iframe( $resolved['type'], $resolved['id'] );
	}

	/**
	 * Cheap host-based gate so non-Strava URLs short-circuit without a full
	 * parse/resolve pass.
	 *
	 * `stripos( $url, 'strava' )` was tempting but matched any URL with the
	 * substring anywhere (`https://example.com/?q=strava`). Parsing the host
	 * is barely more expensive and avoids running the resolver against URLs
	 * whose origin isn't actually Strava.
	 *
	 * @param  string $url Candidate URL.
	 * @return bool        True when the URL's host is strava.com (or a
	 *                     subdomain) or strava.app.link.
	 */
	private static function is_strava_host( string $url ): bool {
		return self::is_allowed_strava_url(
			$url,
			array( 'strava.com', 'strava.app.link' )
		);
	}

	/**
	 * Resolves any supported Strava URL form to a canonical {type, id}.
	 *
	 * For strava.app.link short URLs, performs a remote lookup gated by the
	 * SSRF-safe helper inside `resolve_strava_url()`. The lookup result
	 * (positive or negative) is memoized in a transient because
	 * `render_strava_embed` runs on every front-end render of the post —
	 * without the cache, a saved short-URL embed would trigger up to five
	 * `wp_safe_remote_head()` requests per page view.
	 *
	 * @param  string $url The URL to resolve.
	 * @return array|null  ['type' => 'activity'|'route'|'segment', 'id' => '<digits>'] or null.
	 */
	private static function resolve_to_canonical( string $url ): ?array {
		$parsed = self::parse_strava_url( $url );
		if ( false !== $parsed ) {
			return $parsed;
		}

		$cache_key = 'block_for_strava_resolved_' . md5( $url );
		$cached    = get_transient( $cache_key );
		if ( false !== $cached ) {
			// Sentinel `0` records a previously-failed resolution so we
			// don't keep re-fetching for the same broken short URL.
			return is_array( $cached ) ? $cached : null;
		}

		$resolved = self::resolve_strava_url( $url );
		if ( is_wp_error( $resolved ) ) {
			set_transient( $cache_key, 0, 5 * MINUTE_IN_SECONDS );
			return null;
		}
		$parsed = self::parse_strava_url( $resolved );
		if ( false === $parsed ) {
			set_transient( $cache_key, 0, 5 * MINUTE_IN_SECONDS );
			return null;
		}

		set_transient( $cache_key, $parsed, DAY_IN_SECONDS );
		return $parsed;
	}

	/**
	 * Parses the embed type and id from a canonical Strava URL.
	 *
	 * Recognizes activities, routes, and segments. The URL path uses plural
	 * segments ("/activities/123") but Strava's embed.js expects the singular
	 * type as `data-embed-type` ("activity"), so the returned `type` is
	 * normalized to the singular form.
	 *
	 * @param  string $url The URL to parse.
	 * @return array|false ['type' => 'activity'|'route'|'segment', 'id' => '<digits>'] or false.
	 */
	public static function parse_strava_url( string $url ) {
		$parsed = wp_parse_url( $url );
		if ( ! is_array( $parsed ) || empty( $parsed['host'] ) || empty( $parsed['path'] ) ) {
			return false;
		}

		$host = strtolower( $parsed['host'] );
		if ( 'strava.com' !== $host && ! str_ends_with( $host, '.strava.com' ) ) {
			return false;
		}

		if ( preg_match( '#^/(activities|routes|segments)/(\d+)(?:/|$)#i', $parsed['path'], $matches ) ) {
			$plural_to_singular = array(
				'activities' => 'activity',
				'routes'     => 'route',
				'segments'   => 'segment',
			);
			return array(
				'type' => $plural_to_singular[ strtolower( $matches[1] ) ],
				'id'   => $matches[2],
			);
		}
		return false;
	}

	/**
	 * Determines whether a URL uses http(s) and a host on the supplied allowlist
	 * (exact match or proper subdomain).
	 *
	 * Host comparison is anchored on a leading dot so that hostnames such as
	 * `evilstrava.app.link` do not satisfy the allowlist via plain suffix matching.
	 *
	 * @param  string   $url           The URL to validate.
	 * @param  string[] $allowed_hosts Hosts whose domain (and subdomains) are permitted.
	 *                                 Entries must be lowercase; comparison is case-sensitive.
	 * @return bool     True if the URL is safe to fetch.
	 */
	public static function is_allowed_strava_url( string $url, array $allowed_hosts ): bool {
		$parsed = wp_parse_url( $url );
		if ( false === $parsed || empty( $parsed['host'] ) || empty( $parsed['scheme'] ) ) {
			return false;
		}

		$scheme = strtolower( $parsed['scheme'] );
		if ( 'http' !== $scheme && 'https' !== $scheme ) {
			return false;
		}

		$host = strtolower( $parsed['host'] );
		foreach ( $allowed_hosts as $allowed ) {
			if ( $host === $allowed || str_ends_with( $host, '.' . $allowed ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Resolves a strava.app.link short URL to a canonical strava.com URL
	 * by following HTTP redirects one hop at a time.
	 *
	 * Only http(s) URLs on `strava.app.link` are accepted as input, and redirects
	 * are only followed when the target host is on `strava.app.link` or
	 * `strava.com`. Uses `wp_safe_remote_head()` so private/loopback addresses
	 * are blocked by WordPress's safe-HTTP filters (SSRF defense).
	 *
	 * @param  string $url The short URL to resolve.
	 * @return string|WP_Error The canonical URL, or a WP_Error on failure.
	 */
	public static function resolve_strava_url( string $url ) {
		if ( ! self::is_allowed_strava_url( $url, array( 'strava.app.link' ) ) ) {
			return new WP_Error(
				'unsupported_url',
				__( 'URL is not a supported Strava short URL.', 'block-for-strava' ),
				array( 'status' => 400 )
			);
		}

		$redirect_allowlist = array( 'strava.app.link', 'strava.com' );
		$current            = $url;
		for ( $i = 0; $i < 5; $i++ ) {
			$response = wp_safe_remote_head( $current, array( 'redirection' => 0 ) );

			if ( is_wp_error( $response ) ) {
				return new WP_Error(
					'request_failed',
					__( 'Failed to resolve Strava short URL.', 'block-for-strava' ),
					array( 'status' => 500 )
				);
			}

			$code = wp_remote_retrieve_response_code( $response );

			if ( in_array( $code, array( 301, 302, 303, 307, 308 ), true ) ) {
				$location = wp_remote_retrieve_header( $response, 'location' );
				if ( empty( $location ) || ! self::is_allowed_strava_url( $location, $redirect_allowlist ) ) {
					break;
				}
				$current = $location;
				if ( self::parse_strava_url( $current ) ) {
					return $current;
				}
			} elseif ( 200 === $code ) {
				return $current;
			} else {
				break;
			}
		}

		return new WP_Error(
			'resolution_failed',
			__( 'Could not resolve Strava short URL to an activity.', 'block-for-strava' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Registers `/block-for-strava/v1/embed-status` so the editor can warn
	 * the user before save when an activity URL alone won't render.
	 *
	 * Strava's per-activity share token (`data-token` on the placeholder
	 * div) is only available to a logged-in browser session via the share
	 * dialog — it isn't in the unauthenticated activity HTML, so there's
	 * no server-side path that can mint one for a URL-only paste. What we
	 * CAN do is HEAD the embed iframe URL on the user's behalf and tell
	 * the editor whether the URL alone produces a working iframe (200) or
	 * Strava's "Error code: EEE" page (403). The editor uses that signal
	 * to show a notice with instructions to paste the share-dialog snippet
	 * instead. Gated by `edit_posts` because the preflight causes outbound
	 * HTTP and we don't want unauthenticated callers using us as a probe.
	 */
	public static function register_rest_routes(): void {
		register_rest_route(
			'block-for-strava/v1',
			'/embed-status',
			array(
				'methods'             => 'GET',
				'permission_callback' => static function () {
					return current_user_can( 'edit_posts' );
				},
				'args'                => array(
					'type' => array(
						'required'          => true,
						'validate_callback' => static function ( $value ) {
							return is_string( $value ) && in_array( $value, array( 'activity', 'route', 'segment' ), true );
						},
						'sanitize_callback' => static function ( $value ) {
							return (string) $value;
						},
					),
					'id'   => array(
						'required'          => true,
						'validate_callback' => static function ( $value ) {
							/*
							 * `(string)` first so an integer query param
							 * (which `WP_REST_Request` may keep as a native
							 * int) round-trips through ctype_digit cleanly;
							 * `is_numeric` would let through scientific
							 * notation and signed numbers Strava's path
							 * doesn't accept.
							 */
							return is_string( $value ) || is_int( $value )
								? ctype_digit( (string) $value )
								: false;
						},
						'sanitize_callback' => static function ( $value ) {
							return (string) $value;
						},
					),
				),

				/*
				 * `embeddable` is the question the editor cares about;
				 * surfacing the raw HTTP code too keeps the response
				 * useful if a future UI wants to differentiate
				 * "doesn't exist" (404) from "needs token" (403).
				 */
				'callback'            => static function ( WP_REST_Request $request ) {
					$type   = (string) $request->get_param( 'type' );
					$id     = (string) $request->get_param( 'id' );
					$status = self::probe_embed_status( $type, $id );
					return new WP_REST_Response(
						array(
							'embeddable' => 200 === $status,
							'status'     => $status,
						)
					);
				},
			)
		);
	}

	/**
	 * HEADs the strava-embeds.com URL for a given resource and returns the
	 * resulting HTTP status (or 0 on transport failure).
	 *
	 * Result is memoized in a transient so the editor's polling on every
	 * URL change (and any front-end render that ever calls in here) doesn't
	 * fan out into one HTTP request per render. Negative results cache
	 * short — Strava can flip an activity's visibility back to Everyone at
	 * any moment, and we'd rather have the next paste re-probe than show a
	 * stale "not embeddable" warning for a day.
	 *
	 * @param  string $embed_type One of 'activity'|'route'|'segment'.
	 * @param  string $resource_id Numeric Strava resource ID.
	 * @return int                 HTTP status code, or 0 on transport failure.
	 */
	private static function probe_embed_status( string $embed_type, string $resource_id ): int {
		$cache_key = 'block_for_strava_embed_status_' . md5( $embed_type . ':' . $resource_id );
		$cached    = get_transient( $cache_key );
		if ( false !== $cached && is_int( $cached ) ) {
			return $cached;
		}

		$response = wp_safe_remote_head(
			sprintf(
				'https://strava-embeds.com/%s/%s',
				rawurlencode( $embed_type ),
				rawurlencode( $resource_id )
			),
			array(
				'timeout'     => 5,
				'redirection' => 0,
			)
		);

		if ( is_wp_error( $response ) ) {
			set_transient( $cache_key, 0, 5 * MINUTE_IN_SECONDS );
			return 0;
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		/*
		 * Cache 200s long (a public activity won't flip private often)
		 * and non-200s short (private activities frequently get unblocked).
		 */
		set_transient(
			$cache_key,
			$status,
			200 === $status ? DAY_IN_SECONDS : 5 * MINUTE_IN_SECONDS
		);
		return $status;
	}

	/**
	 * Builds the iframe HTML that points directly at Strava's embed page.
	 *
	 * Earlier iterations wrapped a placeholder div + embed.js in a `data:`
	 * URL iframe, but a sandboxed srcdoc/data-URL frame inherits its null
	 * origin into the nested strava-embeds.com iframe that embed.js creates.
	 * The nested frame's CORS fetches (`/map-style/*` for routes) then go out
	 * as origin `null` and Strava rejects them, so route maps silently never
	 * render. Pointing the top-level iframe at strava-embeds.com directly
	 * gives it the real Strava origin and the map loads.
	 *
	 * `allow-scripts allow-same-origin` is what lets Strava's embed page
	 * read its own resources at strava-embeds.com (it does NOT grant the
	 * iframe access to the host page — the cross-origin boundary handles
	 * that). The popup flags keep the "View on Strava" link working as a
	 * normal tab. `referrerpolicy=origin` stops the host page URL from
	 * leaking to Strava.
	 *
	 * @param  string   $embed_type  One of 'activity', 'route', 'segment'.
	 * @param  string   $activity_id Numeric Strava ID.
	 * @param  int|null $width       Preferred width in pixels (null = default).
	 * @param  int|null $height      Preferred height in pixels (null = default).
	 * @param  array    $params      Optional Strava embed-page query params.
	 * @return string                Iframe HTML.
	 */
	private static function build_iframe( string $embed_type, string $activity_id, ?int $width = null, ?int $height = null, array $params = array() ): string {
		$src = sprintf(
			'https://strava-embeds.com/%s/%s',
			rawurlencode( $embed_type ),
			rawurlencode( $activity_id )
		);
		if ( ! empty( $params ) ) {
			$src .= '?' . http_build_query( $params, '', '&', PHP_QUERY_RFC3986 );
		}

		$resolved_width  = $width ?? self::DEFAULT_WIDTH;
		$resolved_height = $height ?? self::DEFAULT_HEIGHT;

		/*
		 * The plugin no longer ships a frontend stylesheet, so without an
		 * inline cap the fixed `width="600"` would overflow narrower
		 * containers (classic content, widget areas, mobile viewports).
		 *
		 * When the route opts into `fullWidth`, drop the `max-width` cap so
		 * the iframe element matches the responsive Strava embed page inside
		 * — otherwise the inner page renders responsive but the outer iframe
		 * stays clamped at 600px and the toggle has no visible effect.
		 */
		$is_full_width = isset( $params['fullWidth'] ) && 'true' === $params['fullWidth'];
		$style         = $is_full_width
			? 'width:100%;display:block;border:0;'
			: sprintf( 'width:100%%;max-width:%dpx;display:block;border:0;', $resolved_width );

		return sprintf(
			'<iframe class="strava-embed-iframe" src="%s" width="%d" height="%d" style="%s" frameborder="0" scrolling="no" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="origin" title="%s"></iframe>',
			esc_url( $src ),
			$resolved_width,
			$resolved_height,
			esc_attr( $style ),
			esc_attr__( 'Strava embed', 'block-for-strava' )
		);
	}
}
