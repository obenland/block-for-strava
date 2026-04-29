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
		add_filter( 'render_block_core/embed', array( self::class, 'apply_route_params' ), 10, 2 );

		/*
		 * Subdomain group matches the host check in
		 * `block_for_strava_parse_strava_url()` (any `*.strava.com`). The
		 * trailing `(?:[/?#]|$)` rejects `/activities/123abc` so the digits
		 * can't greedily match an unrelated path. Pattern uses `~` as the
		 * delimiter so the `#` inside the character class is unescaped.
		 * Priority < 10 so we beat any generic handler a theme might add.
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
		if ( null !== $result || false === stripos( $url, 'strava' ) ) {
			return $result;
		}

		$resolved = self::resolve_to_canonical( $url );
		if ( null === $resolved ) {
			return null;
		}

		return self::build_iframe(
			$resolved['type'],
			$resolved['id'],
			isset( $args['width'] ) ? (int) $args['width'] : null,
			isset( $args['height'] ) ? (int) $args['height'] : null
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
		if ( false === stripos( $url, 'strava' ) ) {
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
	 * Appends Strava's route customization params to the iframe URL when a
	 * core/embed block carries our variation's route attributes.
	 *
	 * Block variations can't carry their own attributes; the route options
	 * live on `core/embed` itself (added via the JS `blocks.registerBlockType`
	 * filter) and are honored only when `providerNameSlug === 'strava'` and
	 * the URL targets a route. We post-process the rendered block content
	 * because the oEmbed pipeline doesn't expose block attributes — by the
	 * time `wp_oembed_get` runs, all we have is the URL.
	 *
	 * @param  string $block_content The original rendered block HTML.
	 * @param  array  $block         Parsed block (including attrs).
	 * @return string                Possibly-rewritten HTML.
	 */
	public static function apply_route_params( string $block_content, array $block ): string {
		$attrs = isset( $block['attrs'] ) && is_array( $block['attrs'] ) ? $block['attrs'] : array();
		if ( ( $attrs['providerNameSlug'] ?? '' ) !== 'strava' ) {
			return $block_content;
		}
		$resolved = self::resolve_to_canonical( (string) ( $attrs['url'] ?? '' ) );
		if ( null === $resolved || 'route' !== $resolved['type'] ) {
			return $block_content;
		}
		$params = self::route_params_from_attrs( $attrs );
		if ( empty( $params ) ) {
			return $block_content;
		}

		$new_src = sprintf(
			'https://strava-embeds.com/route/%s?%s',
			rawurlencode( $resolved['id'] ),
			http_build_query( $params, '', '&', PHP_QUERY_RFC3986 )
		);

		/*
		 * Replace the iframe `src` in place rather than re-rendering — that
		 * preserves whatever wrapper markup core/embed produced (the
		 * `wp-block-embed`/`is-provider-strava` class set, alignment, etc.).
		 * Only the first iframe is touched in case a theme wraps the embed
		 * in additional iframes.
		 */
		return preg_replace(
			'~(<iframe\b[^>]*\bsrc=")[^"]*(")~i',
			'${1}' . esc_attr( $new_src ) . '${2}',
			$block_content,
			1
		);
	}

	/**
	 * Extracts the Strava route URL params from a block's attributes.
	 *
	 * Mirrors the convention from PR #22's editor-side `buildEmbedQuery`:
	 * `style` is always emitted; the rest only when the user has chosen a
	 * non-default value, so Strava's iframe falls back to its own defaults
	 * for anything we don't override.
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
		if ( ! empty( $attrs['stravaRouteFullWidth'] ) ) {
			$params['fullWidth'] = 'true';
		}
		$terrain = $attrs['stravaRouteTerrain'] ?? 'auto';
		if ( in_array( $terrain, array( '2d', '3d' ), true ) ) {
			$params['terrain'] = $terrain;
		}
		if ( ! empty( $attrs['stravaRouteShowDirt'] ) ) {
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
	 * Resolves any supported Strava URL form to a canonical {type, id}.
	 *
	 * For strava.app.link short URLs, performs a remote lookup gated by the
	 * SSRF-safe helper inside `block_for_strava_resolve_strava_url`.
	 *
	 * @param  string $url The URL to resolve.
	 * @return array|null  ['type' => 'activity'|'route'|'segment', 'id' => '<digits>'] or null.
	 */
	private static function resolve_to_canonical( string $url ): ?array {
		$parsed = block_for_strava_parse_strava_url( $url );
		if ( false !== $parsed ) {
			return $parsed;
		}

		$resolved = block_for_strava_resolve_strava_url( $url );
		if ( is_wp_error( $resolved ) ) {
			return null;
		}
		$parsed = block_for_strava_parse_strava_url( $resolved );
		return false === $parsed ? null : $parsed;
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
	 * @return string                Iframe HTML.
	 */
	private static function build_iframe( string $embed_type, string $activity_id, ?int $width = null, ?int $height = null ): string {
		$src = sprintf(
			'https://strava-embeds.com/%s/%s',
			rawurlencode( $embed_type ),
			rawurlencode( $activity_id )
		);

		return sprintf(
			'<iframe class="strava-embed-iframe" src="%s" width="%d" height="%d" frameborder="0" scrolling="no" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="origin" title="%s"></iframe>',
			esc_url( $src ),
			$width ?? self::DEFAULT_WIDTH,
			$height ?? self::DEFAULT_HEIGHT,
			esc_attr__( 'Strava embed', 'block-for-strava' )
		);
	}
}
