<?php
/**
 * Strava oEmbed hijack.
 *
 * Strava does not publish an oEmbed endpoint, but the share dialog ships an
 * iframe-friendly placeholder + script. This class makes Strava URLs behave
 * like a first-class embed provider so a pasted URL flows through the
 * standard `core/embed` pipeline (paste detection, preview, caching, render)
 * without requiring our custom block.
 *
 * The pattern is borrowed from the ActivityPub plugin's `Embed` class:
 * - `pre_oembed_result` short-circuits `wp_oembed_get()` for Strava URLs.
 * - `rest_request_after_callbacks` rewrites the editor's `/oembed/1.0/proxy`
 *   response so the embed block receives valid HTML even though Strava has
 *   no provider.
 * - `wp_embed_register_handler()` covers autoembed inside post_content
 *   (classic editor / shortcode-style URLs).
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Hijacks oEmbed lookups for Strava URLs and returns a self-contained iframe
 * that loads Strava's official embed.js inside a sandbox.
 */
class Block_For_Strava_Embed {

	/**
	 * Allowed embed types (singular, as Strava's embed.js expects).
	 *
	 * @var string[]
	 */
	private const EMBED_TYPES = array( 'activity', 'route', 'segment' );

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

		/*
		 * Two regex handlers cover canonical strava.com paths and short links.
		 * Priority < 10 so we beat any generic handler a theme might add.
		 *
		 * The canonical regex's subdomain group matches the host check in
		 * block_for_strava_parse_strava_url() (any `*.strava.com`). The
		 * trailing `(?:[/?#]|$)` rejects `/activities/123abc` so the digits
		 * can't greedily match an unrelated path. Pattern uses `~` as the
		 * delimiter so the `#` inside the character class is unescaped.
		 */
		wp_embed_register_handler(
			'block-for-strava-canonical',
			'~https?://(?:[a-z0-9-]+\.)*strava\.com/(activities|routes|segments)/(\d+)(?:[/?#]|$)~i',
			array( self::class, 'embed_handler_canonical' ),
			5
		);
		wp_embed_register_handler(
			'block-for-strava-short',
			'#https?://strava\.app\.link/[^\s]+#i',
			array( self::class, 'embed_handler_short' ),
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
		if ( null !== $result ) {
			return $result;
		}

		$resolved = self::resolve_to_canonical( $url );
		if ( null === $resolved ) {
			return null;
		}

		return self::build_iframe(
			$resolved['type'],
			$resolved['id'],
			isset( $args['width'] ) ? (int) $args['width'] : 0,
			isset( $args['height'] ) ? (int) $args['height'] : 0
		);
	}

	/**
	 * Rewrites the `/oembed/1.0/proxy` REST response so the editor sees a
	 * proper Strava-branded oEmbed payload.
	 *
	 * Core's proxy endpoint already falls back to `wp_embed_register_handler`
	 * callbacks when no oEmbed provider matches — and that's where our
	 * iframe HTML comes from. But the fallback response is generically
	 * branded `provider_name: 'Embed Handler'` and lacks a `type`, which the
	 * embed block surfaces verbatim in its toolbar / preview header. We
	 * rebrand here so the variation looks like a first-class provider, and
	 * we synthesize the response from scratch only if our handler somehow
	 * failed (defense-in-depth — the user's paste flow shouldn't dead-end
	 * with a 404 because of a registration ordering glitch).
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

		$url      = (string) $request->get_param( 'url' );
		$resolved = self::resolve_to_canonical( $url );
		if ( null === $resolved ) {
			return $response;
		}

		/*
		 * Core's get_proxy_item returns either a WP_Error (no provider, no
		 * handler) or a stdClass (provider data, or "Embed Handler" payload).
		 * Only synthesize for oembed-lookup failures — other WP_Errors that
		 * make it this far (rest_cookie_invalid_nonce, rest_forbidden, etc.)
		 * must propagate untouched so the editor can react to auth state.
		 */
		if ( is_wp_error( $response ) ) {
			return 'oembed_invalid_url' === $response->get_error_code()
				? self::synthesize_proxy_response( $resolved['type'], $resolved['id'] )
				: $response;
		}

		$payload = $response instanceof WP_REST_Response
			? $response->get_data()
			: ( is_object( $response ) ? $response : null );

		if ( ! is_object( $payload ) || empty( $payload->html ) ) {
			return self::synthesize_proxy_response( $resolved['type'], $resolved['id'] );
		}

		$payload->provider_name = 'Strava';
		$payload->provider_url  = 'https://www.strava.com/';
		if ( ! isset( $payload->type ) ) {
			$payload->type = 'rich';
		}

		if ( $response instanceof WP_REST_Response ) {
			$response->set_data( $payload );
			return $response;
		}
		return $payload;
	}

	/**
	 * Builds a Strava-branded proxy response when core didn't get there.
	 *
	 * @param  string $embed_type  Singular embed type.
	 * @param  string $activity_id Numeric Strava ID.
	 * @return stdClass
	 */
	private static function synthesize_proxy_response( string $embed_type, string $activity_id ): stdClass {
		return (object) array(
			'provider_name' => 'Strava',
			'provider_url'  => 'https://www.strava.com/',
			'html'          => self::build_iframe( $embed_type, $activity_id ),
			'type'          => 'rich',
			'scripts'       => array(),
		);
	}

	/**
	 * `wp_embed_register_handler` callback for canonical Strava paths.
	 *
	 * @param  array $matches The regex match groups.
	 * @return string|false   Iframe HTML, or false to fall through.
	 */
	public static function embed_handler_canonical( $matches ) {
		$plural_to_singular = array(
			'activities' => 'activity',
			'routes'     => 'route',
			'segments'   => 'segment',
		);
		$key                = strtolower( (string) ( $matches[1] ?? '' ) );
		if ( ! isset( $plural_to_singular[ $key ] ) ) {
			return false;
		}
		$id = (string) ( $matches[2] ?? '' );
		if ( '' === $id || ! ctype_digit( $id ) ) {
			return false;
		}
		return self::build_iframe( $plural_to_singular[ $key ], $id );
	}

	/**
	 * `wp_embed_register_handler` callback for strava.app.link short URLs.
	 *
	 * Resolves the short URL to a canonical strava.com URL via the existing
	 * SSRF-safe redirect-chaser; returns false on failure so WordPress keeps
	 * the bare URL in place (matching the autoembed contract).
	 *
	 * @param  array $matches The regex match groups (full URL in [0]).
	 * @return string|false   Iframe HTML, or false to fall through.
	 */
	public static function embed_handler_short( $matches ) {
		$resolved = self::resolve_to_canonical( (string) ( $matches[0] ?? '' ) );
		if ( null === $resolved ) {
			return false;
		}
		return self::build_iframe( $resolved['type'], $resolved['id'] );
	}

	/**
	 * Resolves any supported Strava URL form to a canonical {type, id}.
	 *
	 * Returns null for non-Strava URLs so the caller can fall through to
	 * normal processing. For strava.app.link short URLs, performs a remote
	 * lookup; that's gated by the existing SSRF-safe helper so untrusted
	 * input cannot redirect us to internal hosts.
	 *
	 * @param  string $url The URL to resolve.
	 * @return array|null  ['type' => 'activity'|'route'|'segment', 'id' => '<digits>'] or null.
	 */
	private static function resolve_to_canonical( string $url ): ?array {
		$parsed = block_for_strava_parse_strava_url( $url );
		if ( false !== $parsed ) {
			return $parsed;
		}

		if ( ! block_for_strava_is_allowed_strava_url( $url, array( 'strava.app.link' ) ) ) {
			return null;
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
	 * @param  string $embed_type  One of 'activity', 'route', 'segment'.
	 * @param  string $activity_id Numeric Strava ID.
	 * @param  int    $width       Optional preferred width (0 = default).
	 * @param  int    $height      Optional preferred height (0 = default).
	 * @return string              Iframe HTML.
	 */
	private static function build_iframe( string $embed_type, string $activity_id, int $width = 0, int $height = 0 ): string {
		if ( ! in_array( $embed_type, self::EMBED_TYPES, true ) ) {
			$embed_type = 'activity';
		}
		if ( '' === $activity_id || ! ctype_digit( $activity_id ) ) {
			return '';
		}

		$render_width  = $width > 0 ? $width : 600;
		$render_height = $height > 0 ? $height : self::DEFAULT_HEIGHT;

		$src = sprintf(
			'https://strava-embeds.com/%s/%s',
			rawurlencode( $embed_type ),
			rawurlencode( $activity_id )
		);

		return sprintf(
			'<iframe class="strava-embed-iframe" src="%s" width="%d" height="%d" frameborder="0" scrolling="no" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="origin" title="%s"></iframe>',
			esc_url( $src ),
			$render_width,
			$render_height,
			esc_attr__( 'Strava embed', 'block-for-strava' )
		);
	}
}
