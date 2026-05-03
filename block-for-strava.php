<?php
/**
 * Plugin Name: Block for Strava
 * Plugin URI:  https://wordpress.org/plugins/block-for-strava/
 * Description: Embed Strava activities, routes, and segments via a single Gutenberg block. Public resources embed from a URL; followers-only / private activities embed via Strava's share-dialog snippet (which carries a per-share token).
 * Version:     1.0.0
 * Author:      Konstantin Obenland
 * Author URI:  https://obenland.it/
 * Text Domain: block-for-strava
 * Requires at least: 6.6
 * Requires PHP: 8.1
 * License:     GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 *
 * Strava is a trademark of Strava Inc. This plugin is not affiliated with or endorsed by Strava Inc.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

define( 'BLOCK_FOR_STRAVA_VERSION', '1.0.0' );
define( 'BLOCK_FOR_STRAVA_DIR', plugin_dir_path( __FILE__ ) );

/**
 * Registers the block from its build-time block.json.
 *
 * `block.json` declares `editorScript` so core can register the editor
 * bundle and its script translations. The render callback is passed
 * explicitly here because we render from a global function rather than
 * a template file, so block.json carries no `render` entry.
 */
function block_for_strava_register_block(): void {
	register_block_type_from_metadata(
		BLOCK_FOR_STRAVA_DIR . 'build',
		array( 'render_callback' => 'block_for_strava_render_block' )
	);
}
add_action( 'init', 'block_for_strava_register_block' );

/**
 * Block render callback. Resolves the saved URL to a canonical
 * type+id and builds the iframe.
 *
 * @param array $attributes Block attributes (carries `url` and optional `stravaRoute*` overrides).
 * @return string Iframe HTML wrapped in the standard `wp-block-embed` figure, or '' if the URL didn't resolve.
 */
function block_for_strava_render_block( array $attributes ): string {
	$url      = isset( $attributes['url'] ) ? (string) $attributes['url'] : '';
	$resolved = block_for_strava_resolve_to_canonical( $url );
	if ( null === $resolved ) {
		return '';
	}

	$params = 'route' === $resolved['type']
		? block_for_strava_route_params_from_attrs( $attributes )
		: array();

	if ( isset( $attributes['stravaEmbedToken'] ) && is_string( $attributes['stravaEmbedToken'] ) && '' !== $attributes['stravaEmbedToken'] ) {
		$params['token'] = $attributes['stravaEmbedToken'];
	}

	$iframe = block_for_strava_build_iframe( $resolved['type'], $resolved['id'], $params );

	$wrapper_args = array(
		'class' => 'wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava',
	);

	/*
	 * `wp_apply_anchor_support` doesn't flow through to
	 * `get_block_wrapper_attributes()` for dynamic blocks, so
	 * read the saved attribute and pass `id` through ourselves.
	 */
	if ( isset( $attributes['anchor'] ) && is_string( $attributes['anchor'] ) && '' !== $attributes['anchor'] ) {
		$wrapper_args['id'] = $attributes['anchor'];
	}
	$wrapper_attrs = get_block_wrapper_attributes( $wrapper_args );

	$caption_html = '';

	if (
		isset( $attributes['caption'] ) &&
		is_string( $attributes['caption'] ) &&
		'' !== $attributes['caption']
	) {
		$sanitized = wp_kses_post( $attributes['caption'] );
		$plain     = html_entity_decode( wp_strip_all_tags( $sanitized ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		if ( '' !== preg_replace( '/\s+/u', '', $plain ) ) {
			$caption_html = sprintf(
				'<figcaption class="wp-element-caption">%s</figcaption>',
				$sanitized
			);
		}
	}

	return sprintf(
		'<figure %s><div class="wp-block-embed__wrapper">%s</div>%s</figure>',
		$wrapper_attrs,
		$iframe,
		$caption_html
	);
}

/**
 * Extracts the Strava route URL params from a block's attributes.
 *
 * @param array $attrs Block attributes.
 * @return array Param map suitable for `http_build_query`.
 */
function block_for_strava_route_params_from_attrs( array $attrs ): array {
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

	// Strict `=== true` (rather than `! empty()`) mirrors the editor-side `clampBool`.
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

	// Drop the always-on `style` only when it is the sole param and still the default `standard` value.
	if ( count( $params ) === 1 && 'standard' === $params['style'] ) {
		return array();
	}

	return $params;
}

/**
 * Resolves any supported Strava URL form to a canonical {type, id}.
 *
 * @param string $url The URL to resolve.
 * @return array|null ['type' => 'activity'|'route'|'segment', 'id' => '<digits>'] or null.
 */
function block_for_strava_resolve_to_canonical( string $url ): ?array {
	$parsed = block_for_strava_parse_url( $url );
	if ( false !== $parsed ) {
		return $parsed;
	}

	if ( ! block_for_strava_is_allowed_url( $url, array( 'strava.app.link' ) ) ) {
		return null;
	}

	$cache_key = 'block_for_strava_resolved_' . md5( $url );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached ) {
		// Sentinel `0` records a previously failed resolution, so we don't keep re-fetching for the same broken short URL.
		return is_array( $cached ) ? $cached : null;
	}

	$resolved = block_for_strava_resolve_url( $url );
	if ( is_wp_error( $resolved ) ) {
		set_transient( $cache_key, 0, 5 * MINUTE_IN_SECONDS );

		return null;
	}
	$parsed = block_for_strava_parse_url( $resolved );
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
 * segments ("/activities/123"), but Strava's embed page expects the
 * singular type as the leading path segment ("/activity/123"), so the
 * returned `type` is normalized to the singular form.
 *
 * @param string $url The URL to parse.
 * @return array|false ['type' => 'activity'|'route'|'segment', 'id' => '<digits>'] or false.
 */
function block_for_strava_parse_url( string $url ): array|false {
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
 * @param string   $url           The URL to validate.
 * @param string[] $allowed_hosts Hosts whose domain (and subdomains) are permitted.
 *                                Entries must be lowercase; comparison is case-sensitive.
 * @return bool True if the URL is safe to fetch.
 */
function block_for_strava_is_allowed_url( string $url, array $allowed_hosts ): bool {
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
 * @param string $url The short URL to resolve.
 * @return string|WP_Error The canonical URL, or a WP_Error on failure.
 */
function block_for_strava_resolve_url( string $url ): string|WP_Error {
	if ( ! block_for_strava_is_allowed_url( $url, array( 'strava.app.link' ) ) ) {
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
			if ( empty( $location ) || ! block_for_strava_is_allowed_url( $location, $redirect_allowlist ) ) {
				break;
			}
			$current = $location;
			if ( block_for_strava_parse_url( $current ) ) {
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
 * `allow-scripts allow-same-origin` is what lets Strava's embed page
 * read its own resources at strava-embeds.com (it does NOT grant the
 * iframe access to the host page — the cross-origin boundary handles
 * that). The popup flags keep the "View on Strava" link working as a
 * normal tab. `referrerpolicy=origin` stops the host page URL from
 * leaking to Strava.
 *
 * @param string $embed_type  One of 'activity', 'route', 'segment'.
 * @param string $resource_id Numeric Strava ID for the activity, route, or segment.
 * @param array  $params      Optional Strava embed-page query params.
 * @return string Iframe HTML.
 */
function block_for_strava_build_iframe( string $embed_type, string $resource_id, array $params = array() ): string {
	$src = sprintf(
		'https://strava-embeds.com/%s/%s',
		rawurlencode( $embed_type ),
		rawurlencode( $resource_id )
	);
	if ( ! empty( $params ) ) {
		$src .= '?' . http_build_query( $params, '', '&', PHP_QUERY_RFC3986 );
	}

	/*
	 * When the route opts into `fullWidth`, drop the `max-width` cap so
	 * the iframe element matches the responsive Strava embed page inside
	 * — otherwise the inner page renders responsive but the outer iframe
	 * stays clamped at 600px and the toggle has no visible effect.
	 */
	$is_full_width = isset( $params['fullWidth'] ) && 'true' === $params['fullWidth'];
	$style         = $is_full_width
		? 'width:100%;display:block;border:0;'
		: 'width:100%;max-width:600px;display:block;border:0;';

	return sprintf(
		'<iframe class="strava-embed-iframe" src="%s" width="600" height="730" style="%s" frameborder="0" scrolling="no" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="origin" title="%s"></iframe>',
		esc_url( $src ),
		esc_attr( $style ),
		esc_attr__( 'Strava embed', 'block-for-strava' )
	);
}

/**
 * Registers `/block-for-strava/v1/embed-status` so the editor can warn
 * the user before save when an activity URL alone won't render.
 */
function block_for_strava_register_rest_routes(): void {
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
					'type'     => 'string',
					'enum'     => array( 'activity', 'route', 'segment' ),
					'required' => true,
				),
				'id'   => array(
					'type'              => 'string',
					'required'          => true,
					'validate_callback' => static function ( $value ) {
						return ( is_string( $value ) || is_int( $value ) ) && ctype_digit( (string) $value );
					},
				),
			),

			/*
			 * `embeddable` is the question the editor cares about;
			 * surfacing the raw HTTP code keeps the response
			 * useful if a future UI wants to differentiate "doesn't
			 * exist" (404) from "needs token" (403).
			 */
			'callback'            => static function ( WP_REST_Request $request ) {
				$embed_type  = (string) $request->get_param( 'type' );
				$resource_id = (string) $request->get_param( 'id' );

				$cache_key = 'block_for_strava_embed_status_' . md5( $embed_type . ':' . $resource_id );
				$cached    = get_transient( $cache_key );

				/*
				 * Database-backed transients round-trip integers as
				 * numeric strings (the options table stores
				 * serialized strings); a strict `is_int` check would
				 * treat every cache hit after the first request as a
				 * miss and re-HEAD strava-embeds.com on every render.
				 * `is_numeric` + `(int)` accepts both shapes.
				 */
				if ( false !== $cached && is_numeric( $cached ) ) {
					$status = (int) $cached;
				} else {
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
						$status = 0;
						set_transient( $cache_key, $status, 5 * MINUTE_IN_SECONDS );
					} else {
						$status = (int) wp_remote_retrieve_response_code( $response );

						set_transient(
							$cache_key,
							$status,
							200 === $status ? DAY_IN_SECONDS : 5 * MINUTE_IN_SECONDS
						);
					}
				}

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
add_action( 'rest_api_init', 'block_for_strava_register_rest_routes' );
