<?php
/**
 * Utility functions for Block for Strava.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Parses a Strava activity ID from a canonical activity URL.
 *
 * @param  string $url The URL to parse.
 * @return string|false The activity ID, or false if not found.
 */
function block_for_strava_parse_activity_id( string $url ) {
	if ( preg_match( '#strava\.com/activities/(\d+)#i', $url, $matches ) ) {
		return $matches[1];
	}
	return false;
}

/**
 * Resolves a strava.app.link short URL to a canonical strava.com URL
 * by following HTTP redirects one hop at a time.
 *
 * @param  string $url The short URL to resolve.
 * @return string|WP_Error The canonical URL, or a WP_Error on failure.
 */
function block_for_strava_resolve_strava_url( string $url ) {
	$parsed = wp_parse_url( $url );
	if ( empty( $parsed['host'] ) || ! str_ends_with( $parsed['host'], 'strava.app.link' ) ) {
		return new WP_Error(
			'unsupported_url',
			__( 'URL is not a supported Strava short URL.', 'block-for-strava' ),
			array( 'status' => 400 )
		);
	}

	$current = $url;
	for ( $i = 0; $i < 5; $i++ ) {
		$response = wp_remote_head( $current, array( 'redirection' => 0 ) );

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
			if ( empty( $location ) ) {
				break;
			}
			$current = $location;
			if ( block_for_strava_parse_activity_id( $current ) ) {
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
