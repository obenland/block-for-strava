<?php
/**
 * OAuth handler for Block for Strava.
 *
 * The plugin connects to a central OAuth proxy registered with Strava — users
 * never need to provide their own Strava API credentials. The proxy handles
 * the parts of the flow that require the client secret (token exchange and
 * refresh) and returns tokens to the WordPress site over a one-time code.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

/**
 * Manages the Strava OAuth flow and per-user token storage.
 */
class Block_For_Strava_OAuth {

	const USER_META_KEY          = '_block_for_strava_token';
	const STATE_TRANSIENT_PREFIX = 'block_for_strava_state_';
	const DEFAULT_PROXY_URL      = 'https://strava-proxy.obenland.it';

	/**
	 * Singleton instance.
	 *
	 * @var Block_For_Strava_OAuth|null
	 */
	private static ?Block_For_Strava_OAuth $instance = null;

	/**
	 * Returns the singleton instance.
	 *
	 * @return Block_For_Strava_OAuth
	 */
	public static function get_instance(): Block_For_Strava_OAuth {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor.
	 */
	private function __construct() {
		add_action( 'admin_post_block_for_strava_oauth_authorize', array( $this, 'handle_authorize' ) );
		add_action( 'admin_post_block_for_strava_oauth_callback', array( $this, 'handle_callback' ) );
	}

	/**
	 * Returns the OAuth proxy base URL.
	 *
	 * Override with the `block_for_strava_oauth_proxy_url` filter.
	 *
	 * @return string
	 */
	public static function get_proxy_url(): string {
		/**
		 * Filters the OAuth proxy base URL.
		 *
		 * @param string $url Proxy URL.
		 */
		$url = (string) apply_filters( 'block_for_strava_oauth_proxy_url', self::DEFAULT_PROXY_URL );

		return untrailingslashit( $url );
	}

	/**
	 * Returns the URL the OAuth proxy redirects back to once the flow completes.
	 *
	 * @return string
	 */
	public function get_callback_url(): string {
		return admin_url( 'admin-post.php?action=block_for_strava_oauth_callback' );
	}

	/**
	 * Returns the stored token for a user.
	 *
	 * @param int $user_id User ID.
	 * @return array|null
	 */
	public static function get_token( int $user_id ): ?array {
		$stored = get_user_meta( $user_id, self::USER_META_KEY, true );
		if ( empty( $stored ) || ! is_array( $stored ) ) {
			return null;
		}
		return $stored;
	}

	/**
	 * Stores a token for a user.
	 *
	 * @param int   $user_id User ID.
	 * @param array $token   Token payload.
	 */
	public static function set_token( int $user_id, array $token ): void {
		update_user_meta( $user_id, self::USER_META_KEY, $token );
	}

	/**
	 * Deletes the stored token for a user and fires the cleanup action.
	 *
	 * Per the Strava API Agreement, when a user revokes access (or our token
	 * is rejected as revoked), all related data must be deleted. Listeners
	 * of `block_for_strava_token_deleted` should clear any caches or derived
	 * data they keep keyed on the user.
	 *
	 * @param int $user_id User ID.
	 */
	public static function delete_token( int $user_id ): void {
		delete_user_meta( $user_id, self::USER_META_KEY );

		/**
		 * Fires after a user's Strava token has been deleted.
		 *
		 * @param int $user_id User ID whose token was just removed.
		 */
		do_action( 'block_for_strava_token_deleted', $user_id );
	}

	/**
	 * Builds the proxy authorize URL and stores the per-user state token.
	 *
	 * @param int $user_id User ID this state belongs to.
	 * @return string
	 */
	public function build_authorize_url( int $user_id ): string {
		$state = wp_generate_password( 32, false );
		set_transient( self::STATE_TRANSIENT_PREFIX . $state, $user_id, 10 * MINUTE_IN_SECONDS );

		return add_query_arg(
			array(
				'state'      => $state,
				'return_url' => $this->get_callback_url(),
			),
			self::get_proxy_url() . '/authorize'
		);
	}

	/**
	 * Redeems a one-time code from the proxy for an access token and stores it.
	 *
	 * @param string $state          State token returned via the callback.
	 * @param string $code           One-time code returned by the proxy.
	 * @param string $scope_fallback Scope string forwarded on the callback redirect, used when
	 *                               the proxy's redeem response omits `scope`.
	 * @return array|WP_Error Stored token data on success.
	 */
	public function redeem_code( string $state, string $code, string $scope_fallback = '' ) {
		if ( '' === $state ) {
			return new WP_Error( 'missing_state', __( 'Missing OAuth state.', 'block-for-strava' ), array( 'status' => 400 ) );
		}
		$user_id = get_transient( self::STATE_TRANSIENT_PREFIX . $state );
		delete_transient( self::STATE_TRANSIENT_PREFIX . $state );
		if ( ! $user_id ) {
			return new WP_Error( 'invalid_state', __( 'Invalid or expired OAuth state.', 'block-for-strava' ), array( 'status' => 400 ) );
		}
		if ( '' === $code ) {
			return new WP_Error( 'missing_code', __( 'Missing authorization code.', 'block-for-strava' ), array( 'status' => 400 ) );
		}

		$response = wp_remote_post(
			self::get_proxy_url() . '/redeem',
			array(
				'timeout' => 15,
				'body'    => array( 'code' => $code ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'proxy_request_failed', $response->get_error_message(), array( 'status' => 502 ) );
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		$body   = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== $status || ! is_array( $body ) || empty( $body['access_token'] ) ) {
			$message = is_array( $body ) && ! empty( $body['message'] )
				? (string) $body['message']
				: __( 'Could not exchange the authorization code.', 'block-for-strava' );
			return new WP_Error( 'redeem_failed', $message, array( 'status' => 502 ) );
		}

		$athlete = isset( $body['athlete'] ) && is_array( $body['athlete'] ) ? $body['athlete'] : array();

		/*
		 * Proxy contract: the proxy must forward `scope` from Strava's
		 * authorization callback so we can persist what the athlete
		 * actually granted. Strava's token-exchange response itself does
		 * NOT include `scope`. Either source works here:
		 *  - `scope` field in the proxy's `/redeem` JSON response, OR
		 *  - `scope` query param on the proxy's redirect to our callback
		 *    (passed in as $scope_fallback by handle_callback()).
		 *
		 * If neither source provides scope, we still store the token (with
		 * an empty `scope`) so existing users keep working. has_activity_scope()
		 * treats unknown scope as granted to avoid false-positive warnings,
		 * which means the pre-PR silent-401 loop persists for users on a
		 * legacy proxy who explicitly unchecked activity:read_all on the
		 * Strava consent screen. That edge case is fully resolved only once
		 * the proxy is updated to forward `scope`.
		 */
		$token = array(
			'access_token'  => (string) $body['access_token'],
			'refresh_token' => isset( $body['refresh_token'] ) ? (string) $body['refresh_token'] : '',
			'expires_at'    => isset( $body['expires_at'] ) ? (int) $body['expires_at'] : 0,
			'scope'         => isset( $body['scope'] ) ? (string) $body['scope'] : $scope_fallback,
			'athlete'       => array(
				'id'        => isset( $athlete['id'] ) ? (int) $athlete['id'] : 0,
				'firstname' => isset( $athlete['firstname'] ) ? (string) $athlete['firstname'] : '',
				'lastname'  => isset( $athlete['lastname'] ) ? (string) $athlete['lastname'] : '',
				'profile'   => isset( $athlete['profile'] ) ? (string) $athlete['profile'] : '',
			),
		);
		self::set_token( (int) $user_id, $token );
		return $token;
	}

	/**
	 * Refreshes a token through the OAuth proxy.
	 *
	 * @param int   $user_id User ID.
	 * @param array $token   Current token.
	 * @return array|WP_Error
	 */
	public function refresh_token( int $user_id, array $token ) {
		if ( empty( $token['refresh_token'] ) ) {
			return new WP_Error( 'no_refresh_token', __( 'No refresh token available.', 'block-for-strava' ), array( 'status' => 401 ) );
		}
		$response = wp_remote_post(
			self::get_proxy_url() . '/refresh',
			array(
				'timeout' => 15,
				'body'    => array( 'refresh_token' => (string) $token['refresh_token'] ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'proxy_request_failed', $response->get_error_message(), array( 'status' => 502 ) );
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		$body   = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== $status || ! is_array( $body ) || empty( $body['access_token'] ) ) {
			return new WP_Error( 'refresh_failed', __( 'Failed to refresh Strava token.', 'block-for-strava' ), array( 'status' => 401 ) );
		}
		$new_token = array(
			'access_token'  => (string) $body['access_token'],
			'refresh_token' => isset( $body['refresh_token'] ) ? (string) $body['refresh_token'] : (string) $token['refresh_token'],
			'expires_at'    => isset( $body['expires_at'] ) ? (int) $body['expires_at'] : 0,

			// Strava's refresh response does not echo the granted scope, so we carry it forward from the existing token.
			'scope'         => isset( $token['scope'] ) ? (string) $token['scope'] : '',
			'athlete'       => isset( $token['athlete'] ) && is_array( $token['athlete'] ) ? $token['athlete'] : array(),
		);
		self::set_token( $user_id, $new_token );
		return $new_token;
	}

	/**
	 * Returns whether the granted scope includes any activity-read permission.
	 *
	 * Without `activity:read` (public-only) or `activity:read_all` (includes
	 * private), `/athlete/activities` rejects requests with 401 — which the
	 * client otherwise treats as a revoked token.
	 *
	 * @param array|null $token Stored token, or null.
	 * @return bool
	 */
	public static function has_activity_scope( ?array $token ): bool {
		if ( null === $token ) {
			return false;
		}
		$scope = isset( $token['scope'] ) ? (string) $token['scope'] : '';
		if ( '' === $scope ) {
			/*
			 * Older tokens were stored before we tracked scope. Assume the
			 * scope is present rather than forcing a reconnect.
			 */
			return true;
		}
		return self::scope_grants_activity( $scope );
	}

	/**
	 * Returns whether the OAuth callback should reject a grant on scope grounds.
	 *
	 * True only when the proxy forwarded `scope` AND it lacks activity access.
	 * Empty scope short-circuits to false so legacy proxies (that don't
	 * forward scope yet) fall through to the existing exchange path.
	 *
	 * @param string $scope Scope string from the proxy's redirect query, or empty.
	 * @return bool
	 */
	public static function should_gate_callback_for_scope( string $scope ): bool {
		return '' !== $scope && ! self::scope_grants_activity( $scope );
	}

	/**
	 * Returns whether a raw scope string grants any activity-read permission.
	 *
	 * Used at OAuth callback time, before a token has been exchanged or
	 * stored, to decide whether the grant is sufficient to proceed.
	 *
	 * @param string $scope Space- or comma-delimited scope string from Strava.
	 * @return bool
	 */
	public static function scope_grants_activity( string $scope ): bool {
		if ( '' === $scope ) {
			return false;
		}

		/*
		 * Strava's docs describe scope as space-delimited, but the OAuth
		 * callback historically returns it comma-separated. Accept either.
		 */
		$granted = preg_split( '/[\s,]+/', $scope, -1, PREG_SPLIT_NO_EMPTY );
		return in_array( 'activity:read', $granted, true )
			|| in_array( 'activity:read_all', $granted, true );
	}

	/**
	 * Handles the admin-post action that initiates the OAuth flow.
	 *
	 * @codeCoverageIgnore
	 */
	public function handle_authorize(): void {
		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_die( esc_html__( 'You do not have permission to do that.', 'block-for-strava' ), 403 );
		}
		check_admin_referer( 'block_for_strava_oauth_authorize' );
		$url = $this->build_authorize_url( get_current_user_id() );
		wp_redirect( $url ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect
		exit;
	}

	/**
	 * Handles the admin-post action for the OAuth callback.
	 *
	 * Implements step 6 of Strava's OAuth flow: when the proxy forwards
	 * `scope` on the redirect, we verify the athlete granted activity-read
	 * access BEFORE exchanging the code for a token, and short-circuit with
	 * a re-prompt message if not. When `scope` is absent (legacy proxy that
	 * does not yet forward it) we fall through to the exchange and surface
	 * any scope problem in the editor instead.
	 *
	 * @codeCoverageIgnore
	 */
	public function handle_callback(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		$state = isset( $_GET['state'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['state'] ) ) : '';
		$code  = isset( $_GET['code'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['code'] ) ) : '';
		$error = isset( $_GET['error'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['error'] ) ) : '';
		$scope = isset( $_GET['scope'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['scope'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		if ( '' !== $error ) {
			$this->render_callback_html(
				'error',
				sprintf(
					/* translators: %s: Strava OAuth error code. */
					__( 'Strava authorization denied: %s', 'block-for-strava' ),
					$error
				)
			);
			return;
		}

		if ( self::should_gate_callback_for_scope( $scope ) ) {
			$this->render_callback_html(
				'error',
				__( 'Strava authorization is missing the required permissions. Please try again and approve "View data about your activities".', 'block-for-strava' )
			);
			return;
		}

		$result = $this->redeem_code( $state, $code, $scope );
		if ( is_wp_error( $result ) ) {
			$this->render_callback_html( 'error', $result->get_error_message() );
			return;
		}
		$this->render_callback_html( 'success', __( 'Connected to Strava.', 'block-for-strava' ) );
	}

	/**
	 * Renders the popup HTML that postMessages the opener and closes itself.
	 *
	 * @codeCoverageIgnore
	 *
	 * @param string $status  'success' or 'error'.
	 * @param string $message Human-readable message.
	 */
	private function render_callback_html( string $status, string $message ): void {
		nocache_headers();
		$payload = wp_json_encode(
			array(
				'type'    => 'block-for-strava-oauth',
				'status'  => $status,
				'message' => $message,
			)
		);
		?><!doctype html>
<html><head><meta charset="utf-8"><title><?php esc_html_e( 'Strava Authorization', 'block-for-strava' ); ?></title></head>
<body><p><?php echo esc_html( $message ); ?></p>
<script>
(function(){
	try {
		if (window.opener && !window.opener.closed) {
			window.opener.postMessage(<?php echo $payload; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>, window.location.origin);
		}
	} catch(e){}
	window.setTimeout(function(){ try { window.close(); } catch(e){} }, 800);
})();
</script>
</body></html>
		<?php
		exit;
	}
}
