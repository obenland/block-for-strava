<?php
/**
 * Utility functions for Block for Strava.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

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
function block_for_strava_parse_strava_url( string $url ) {
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
function block_for_strava_is_allowed_strava_url( string $url, array $allowed_hosts ): bool {
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
function block_for_strava_resolve_strava_url( string $url ) {
	if ( ! block_for_strava_is_allowed_strava_url( $url, array( 'strava.app.link' ) ) ) {
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
			if ( empty( $location ) || ! block_for_strava_is_allowed_strava_url( $location, $redirect_allowlist ) ) {
				break;
			}
			$current = $location;
			if ( block_for_strava_parse_strava_url( $current ) ) {
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
