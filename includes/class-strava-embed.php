<?php
/**
 * Server-side rendering for the Strava embed block.
 *
 * Strava does not publish an oEmbed endpoint but ships an iframe-friendly
 * embed page at `strava-embeds.com`. This class produces the iframe markup
 * deterministically from the block's saved URL plus its route attributes —
 * the only PHP this plugin runs at request time, scoped to a single block's
 * `render_callback`.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Renders Strava embed blocks server-side.
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
	 * Block render callback. Resolves the saved URL to a canonical
	 * type+id and builds the iframe.
	 *
	 * The block has no `save` (it's dynamic) so attributes are the only
	 * input — `$content` arrives empty. Routes the figure wrapper through
	 * `get_block_wrapper_attributes()` so `align: ['wide', 'full']`
	 * declared in `block.json`, custom classNames, and anchor IDs reach
	 * the rendered HTML.
	 *
	 * Returns an empty string when the URL can't be resolved (missing,
	 * non-Strava, malformed, or short-URL resolution failure) — the
	 * editor's `Edit` component already surfaces the unrecognized state
	 * to the author, so emitting nothing on the front end is honest about
	 * the broken state and avoids leaking a bare URL onto the page.
	 *
	 * @param  array $attributes Block attributes (carries `url` and optional
	 *                           `stravaRoute*` overrides).
	 * @return string            Iframe HTML wrapped in the standard
	 *                           `wp-block-embed` figure, or '' if the URL
	 *                           didn't resolve.
	 */
	public static function render_block( array $attributes ): string {
		$url      = isset( $attributes['url'] ) ? (string) $attributes['url'] : '';
		$resolved = self::resolve_to_canonical( $url );
		if ( null === $resolved ) {
			return '';
		}

		$params = 'route' === $resolved['type']
			? self::route_params_from_attrs( $attributes )
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
		 * editor's preflight surfaces as a notice before the post is
		 * saved).
		 *
		 * Strict `is_string` check (rather than a plain cast) so a hand-
		 * edited block storing a non-scalar value — an array would cast
		 * to "Array" and emit `token=Array` into the iframe — falls
		 * through cleanly to the URL-only shape.
		 */
		if ( isset( $attributes['stravaEmbedToken'] ) && is_string( $attributes['stravaEmbedToken'] ) && '' !== $attributes['stravaEmbedToken'] ) {
			$params['token'] = $attributes['stravaEmbedToken'];
		}

		$iframe = self::build_iframe( $resolved['type'], $resolved['id'], null, null, $params );

		$wrapper_attrs = get_block_wrapper_attributes(
			array(
				'class' => 'wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava',
			)
		);

		return sprintf(
			'<figure %s><div class="wp-block-embed__wrapper">%s</div></figure>',
			$wrapper_attrs,
			$iframe
		);
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

		/*
		 * Strict `=== true` (rather than `! empty()`) mirrors the editor-side
		 * `clampBool`: a hand-edited block comment storing the string "false"
		 * is truthy in PHP and would otherwise silently flip these flags on,
		 * diverging from what the editor actually shows.
		 */
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

		/*
		 * Drop the always-on `style` if it's the default and nothing else is
		 * set — the default URL has no params, so we leave it that way.
		 */
		if ( count( $params ) === 1 && 'standard' === $params['style'] ) {
			return array();
		}
		return $params;
	}

	/**
	 * Resolves any supported Strava URL form to a canonical {type, id}.
	 *
	 * For `strava.app.link` short URLs, performs a remote lookup gated by
	 * the SSRF-safe helper inside `resolve_strava_url()`. The lookup
	 * result (positive or negative) is memoized in a transient because
	 * `render_block` runs on every front-end render of the post — without
	 * the cache, a saved short-URL embed would trigger up to five
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

		/*
		 * Short-URL fast-fail: anything that isn't a valid strava.app.link
		 * host won't resolve, so don't pay for the cache lookup or the HTTP
		 * HEAD chase.
		 */
		if ( ! self::is_allowed_strava_url( $url, array( 'strava.app.link' ) ) ) {
			return null;
		}

		$cache_key = 'block_for_strava_resolved_' . md5( $url );
		$cached    = get_transient( $cache_key );
		if ( false !== $cached ) {
			/*
			 * Sentinel `0` records a previously-failed resolution so we
			 * don't keep re-fetching for the same broken short URL.
			 */
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
	 * segments ("/activities/123") but Strava's embed page expects the
	 * singular type as the leading path segment ("/activity/123"), so the
	 * returned `type` is normalized to the singular form.
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
		if ( ! is_array( $parsed ) || empty( $parsed['host'] ) || empty( $parsed['scheme'] ) ) {
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
				 * useful if a future UI wants to differentiate "doesn't
				 * exist" (404) from "needs token" (403).
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
	 * @param  string $embed_type  One of 'activity'|'route'|'segment'.
	 * @param  string $resource_id Numeric Strava resource ID.
	 * @return int                 HTTP status code, or 0 on transport failure.
	 */
	private static function probe_embed_status( string $embed_type, string $resource_id ): int {
		$cache_key = 'block_for_strava_embed_status_' . md5( $embed_type . ':' . $resource_id );
		$cached    = get_transient( $cache_key );

		/*
		 * Database-backed transients round-trip integers as numeric strings
		 * (the options table stores serialized strings); a strict `is_int`
		 * check would treat every cache hit after the first request as a
		 * miss and re-HEAD strava-embeds.com on every render. `is_numeric`
		 * + `(int)` accepts both shapes.
		 */
		if ( false !== $cached && is_numeric( $cached ) ) {
			return (int) $cached;
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
		 * Cache 200s long (a public activity won't flip private often) and
		 * non-200s short (private activities frequently get unblocked).
		 */
		set_transient(
			$cache_key,
			$status,
			200 === $status ? DAY_IN_SECONDS : 5 * MINUTE_IN_SECONDS
		);
		return $status;
	}
}
