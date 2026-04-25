<?php
/**
 * Strava API client for Block for Strava.
 *
 * Architectural invariant: responses returned by this client are only consumed
 * server-side or in the block editor (the activity picker), never rendered on
 * the public-facing frontend. Frontend rendering goes through Strava's
 * embed.js, which Strava controls. This is required by the Strava API
 * Agreement, which restricts displaying API-sourced Strava Data to the
 * connected user only.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Thin wrapper around the Strava API for fetching athlete data.
 */
class Block_For_Strava_API {

	const API_BASE = 'https://www.strava.com/api/v3';

	/**
	 * Returns the athlete record for the connected user.
	 *
	 * @param int $user_id User ID.
	 * @return array|WP_Error
	 */
	public static function get_athlete( int $user_id ) {
		return self::request( $user_id, 'athlete' );
	}

	/**
	 * Returns activities for the connected user.
	 *
	 * @param int   $user_id User ID.
	 * @param array $args    Query args (per_page, page).
	 * @return array|WP_Error
	 */
	public static function get_activities( int $user_id, array $args = array() ) {
		return self::request( $user_id, 'athlete/activities', $args );
	}

	/**
	 * Returns a single activity.
	 *
	 * @param int    $user_id     User ID.
	 * @param string $activity_id Activity ID.
	 * @return array|WP_Error
	 */
	public static function get_activity( int $user_id, string $activity_id ) {
		return self::request( $user_id, 'activities/' . rawurlencode( $activity_id ) );
	}

	/**
	 * Performs an authenticated GET request to the Strava API.
	 *
	 * Refreshes the token through the OAuth proxy if it has expired or the
	 * server returns 401.
	 *
	 * @param int    $user_id User ID.
	 * @param string $path    API path.
	 * @param array  $query   Query args.
	 * @return array|WP_Error
	 */
	public static function request( int $user_id, string $path, array $query = array() ) {
		$token = Block_For_Strava_OAuth::get_token( $user_id );
		if ( null === $token ) {
			return new WP_Error( 'not_connected', __( 'Not connected to Strava.', 'block-for-strava' ), array( 'status' => 401 ) );
		}

		$oauth = Block_For_Strava_OAuth::get_instance();

		if ( ! empty( $token['expires_at'] ) && (int) $token['expires_at'] <= ( time() + 60 ) ) {
			$refreshed = $oauth->refresh_token( $user_id, $token );
			if ( is_wp_error( $refreshed ) ) {
				Block_For_Strava_OAuth::delete_token( $user_id );
				return $refreshed;
			}
			$token = $refreshed;
		}

		$url = self::API_BASE . '/' . ltrim( $path, '/' );
		if ( ! empty( $query ) ) {
			$url = add_query_arg( $query, $url );
		}

		$response = self::do_request( $url, (string) $token['access_token'] );
		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) {
			$refreshed = $oauth->refresh_token( $user_id, $token );
			if ( is_wp_error( $refreshed ) ) {
				Block_For_Strava_OAuth::delete_token( $user_id );
				return $refreshed;
			}
			$response = self::do_request( $url, (string) $refreshed['access_token'] );
			if ( is_wp_error( $response ) ) {
				return $response;
			}
			$status = (int) wp_remote_retrieve_response_code( $response );
			if ( 401 === $status ) {
				// Refresh succeeded but the new token is also being rejected,
				// likely because the user revoked the app on Strava's side.
				// Clear the stored token so the user must reconnect.
				Block_For_Strava_OAuth::delete_token( $user_id );
			}
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $status < 200 || $status >= 300 ) {
			$strava_message = is_array( $body ) && ! empty( $body['message'] )
				? (string) $body['message']
				: '';

			if ( 403 === $status ) {
				$message = '' !== $strava_message
					? $strava_message
					: __( 'Strava denied this request. The activity may be private, or the connected account did not grant the required permissions.', 'block-for-strava' );
				return new WP_Error( 'strava_forbidden', $message, array( 'status' => 403 ) );
			}

			if ( 429 === $status ) {
				return new WP_Error(
					'strava_rate_limited',
					__( 'Strava rate limit reached. Please try again in a few minutes.', 'block-for-strava' ),
					array( 'status' => 429 )
				);
			}

			$message = '' !== $strava_message
				? $strava_message
				: __( 'Strava API request failed.', 'block-for-strava' );
			return new WP_Error( 'strava_api_error', $message, array( 'status' => $status ) );
		}

		return $body;
	}

	/**
	 * Notifies Strava that the application no longer has access for this user.
	 *
	 * Per Strava's docs, the deauthorize endpoint lives at the OAuth root
	 * (NOT /api/v3) and takes the access token as a query parameter. Calling
	 * it invalidates the token pair and removes the app from the athlete's
	 * Strava → Apps settings page so disconnect is symmetric on both sides.
	 *
	 * Best-effort: any failure is swallowed because the caller deletes the
	 * local token regardless.
	 *
	 * @param int $user_id User ID.
	 */
	public static function deauthorize( int $user_id ): void {
		$token = Block_For_Strava_OAuth::get_token( $user_id );
		if ( null === $token || empty( $token['access_token'] ) ) {
			return;
		}

		wp_remote_post(
			add_query_arg(
				'access_token',
				(string) $token['access_token'],
				'https://www.strava.com/oauth/deauthorize'
			),
			array( 'timeout' => 10 )
		);
	}

	/**
	 * Performs a single authenticated HTTP GET.
	 *
	 * @param string $url          Fully qualified URL.
	 * @param string $access_token Access token.
	 * @return array|WP_Error
	 */
	private static function do_request( string $url, string $access_token ) {
		return wp_remote_get(
			$url,
			array(
				'timeout' => 15,
				'headers' => array( 'Authorization' => 'Bearer ' . $access_token ),
			)
		);
	}
}
