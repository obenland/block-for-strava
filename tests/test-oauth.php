<?php
/**
 * Tests for the Block_For_Strava_OAuth class.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for the OAuth handler.
 */
class Test_OAuth extends WP_UnitTestCase {

	/**
	 * Editor user ID.
	 *
	 * @var int
	 */
	protected static int $user_id;

	/**
	 * Sets up test fixtures.
	 *
	 * @param WP_UnitTest_Factory $factory Factory instance.
	 */
	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ): void {
		self::$user_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	/**
	 * Tears down test fixtures.
	 */
	public static function wpTearDownAfterClass(): void {
		self::delete_user( self::$user_id );
	}

	/**
	 * Cleans up token storage and HTTP filters between tests.
	 */
	public function tear_down(): void {
		Block_For_Strava_OAuth::delete_token( self::$user_id );
		remove_all_filters( 'pre_http_request' );
		remove_all_filters( 'block_for_strava_oauth_proxy_url' );
		parent::tear_down();
	}

	/**
	 * Tests get proxy url returns default.
	 *
	 * @covers Block_For_Strava_OAuth::get_proxy_url
	 */
	public function test_get_proxy_url_returns_default(): void {
		$this->assertSame(
			'https://strava-proxy.obenland.it',
			Block_For_Strava_OAuth::get_proxy_url()
		);
	}

	/**
	 * Tests get proxy url filter overrides and strips trailing slash.
	 *
	 * @covers Block_For_Strava_OAuth::get_proxy_url
	 */
	public function test_get_proxy_url_filter_overrides_and_strips_trailing_slash(): void {
		add_filter(
			'block_for_strava_oauth_proxy_url',
			static function () {
				return 'https://example.com/';
			}
		);
		$this->assertSame( 'https://example.com', Block_For_Strava_OAuth::get_proxy_url() );
	}

	/**
	 * Tests get callback url.
	 *
	 * @covers Block_For_Strava_OAuth::get_callback_url
	 */
	public function test_get_callback_url(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$this->assertStringContainsString( 'admin-post.php', $oauth->get_callback_url() );
		$this->assertStringContainsString( 'block_for_strava_oauth_callback', $oauth->get_callback_url() );
	}

	/**
	 * Tests get instance returns singleton.
	 *
	 * @covers Block_For_Strava_OAuth::get_instance
	 */
	public function test_get_instance_returns_singleton(): void {
		$this->assertSame(
			Block_For_Strava_OAuth::get_instance(),
			Block_For_Strava_OAuth::get_instance()
		);
	}

	/**
	 * Tests token storage roundtrip.
	 *
	 * @covers Block_For_Strava_OAuth::get_token
	 * @covers Block_For_Strava_OAuth::set_token
	 * @covers Block_For_Strava_OAuth::delete_token
	 */
	public function test_token_storage_roundtrip(): void {
		$this->assertNull( Block_For_Strava_OAuth::get_token( self::$user_id ) );

		$token = array(
			'access_token'  => 'abc',
			'refresh_token' => 'def',
			'expires_at'    => 12345,
			'athlete'       => array( 'id' => 1 ),
		);
		Block_For_Strava_OAuth::set_token( self::$user_id, $token );
		$this->assertSame( $token, Block_For_Strava_OAuth::get_token( self::$user_id ) );

		Block_For_Strava_OAuth::delete_token( self::$user_id );
		$this->assertNull( Block_For_Strava_OAuth::get_token( self::$user_id ) );
	}

	/**
	 * Tests get token returns null for non array meta.
	 *
	 * @covers Block_For_Strava_OAuth::get_token
	 */
	public function test_get_token_returns_null_for_non_array_meta(): void {
		update_user_meta( self::$user_id, Block_For_Strava_OAuth::USER_META_KEY, 'not-an-array' );
		$this->assertNull( Block_For_Strava_OAuth::get_token( self::$user_id ) );
	}

	/**
	 * Tests delete token fires the token_deleted action.
	 *
	 * @covers Block_For_Strava_OAuth::delete_token
	 */
	public function test_delete_token_fires_action(): void {
		Block_For_Strava_OAuth::set_token( self::$user_id, array( 'access_token' => 'a' ) );

		$received = null;
		$callback = static function ( $user_id ) use ( &$received ) {
			$received = $user_id;
		};
		add_action( 'block_for_strava_token_deleted', $callback );

		Block_For_Strava_OAuth::delete_token( self::$user_id );

		remove_action( 'block_for_strava_token_deleted', $callback );

		$this->assertSame( self::$user_id, $received );
	}

	/**
	 * Tests build authorize url persists state and returns url.
	 *
	 * @covers Block_For_Strava_OAuth::build_authorize_url
	 */
	public function test_build_authorize_url_persists_state_and_returns_url(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$url   = $oauth->build_authorize_url( self::$user_id );

		$this->assertStringStartsWith( 'https://strava-proxy.obenland.it/authorize?', $url );

		$query = array();
		parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );

		$this->assertArrayHasKey( 'state', $query );
		$this->assertArrayHasKey( 'return_url', $query );
		$this->assertSame(
			(string) self::$user_id,
			(string) get_transient( Block_For_Strava_OAuth::STATE_TRANSIENT_PREFIX . $query['state'] )
		);

		delete_transient( Block_For_Strava_OAuth::STATE_TRANSIENT_PREFIX . $query['state'] );
	}

	/**
	 * Tests redeem code missing state.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_missing_state(): void {
		$oauth  = Block_For_Strava_OAuth::get_instance();
		$result = $oauth->redeem_code( '', 'code' );
		$this->assertWPError( $result );
		$this->assertSame( 'missing_state', $result->get_error_code() );
	}

	/**
	 * Tests redeem code invalid state.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_invalid_state(): void {
		$oauth  = Block_For_Strava_OAuth::get_instance();
		$result = $oauth->redeem_code( 'unknown-state', 'code' );
		$this->assertWPError( $result );
		$this->assertSame( 'invalid_state', $result->get_error_code() );
	}

	/**
	 * Tests redeem code missing code.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_missing_code(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		$result = $oauth->redeem_code( $state, '' );
		$this->assertWPError( $result );
		$this->assertSame( 'missing_code', $result->get_error_code() );
	}

	/**
	 * Tests redeem code proxy wp error.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_proxy_wp_error(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		add_filter(
			'pre_http_request',
			static function () {
				return new WP_Error( 'http_request_failed', 'Network down' );
			}
		);

		$result = $oauth->redeem_code( $state, 'code' );
		$this->assertWPError( $result );
		$this->assertSame( 'proxy_request_failed', $result->get_error_code() );
		$this->assertSame( 'Network down', $result->get_error_message() );
	}

	/**
	 * Tests redeem code non 200 with message.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_non_200_with_message(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 400 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'message' => 'Bad request' ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->redeem_code( $state, 'code' );
		$this->assertWPError( $result );
		$this->assertSame( 'redeem_failed', $result->get_error_code() );
		$this->assertSame( 'Bad request', $result->get_error_message() );
	}

	/**
	 * Tests redeem code non 200 without message.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_non_200_without_message(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 500 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => 'not-json',
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->redeem_code( $state, 'code' );
		$this->assertWPError( $result );
		$this->assertSame( 'redeem_failed', $result->get_error_code() );
	}

	/**
	 * Tests redeem code success stores token.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_success_stores_token(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode(
						array(
							'access_token'  => 'access',
							'refresh_token' => 'refresh',
							'expires_at'    => 12345,
							'athlete'       => array(
								'id'        => 42,
								'firstname' => 'Sam',
								'lastname'  => 'Runner',
								'profile'   => 'https://example.com/p.jpg',
							),
						)
					),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->redeem_code( $state, 'code' );
		$this->assertIsArray( $result );
		$this->assertSame( 'access', $result['access_token'] );
		$this->assertSame( 'refresh', $result['refresh_token'] );
		$this->assertSame( 12345, $result['expires_at'] );
		$this->assertSame( 42, $result['athlete']['id'] );
		$this->assertSame( 'Sam', $result['athlete']['firstname'] );

		$stored = Block_For_Strava_OAuth::get_token( self::$user_id );
		$this->assertSame( $result, $stored );
	}

	/**
	 * Tests redeem code success handles missing optional fields.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_success_handles_missing_optional_fields(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'access_token' => 'access' ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->redeem_code( $state, 'code' );
		$this->assertIsArray( $result );
		$this->assertSame( '', $result['refresh_token'] );
		$this->assertSame( 0, $result['expires_at'] );
		$this->assertSame( '', $result['scope'] );
		$this->assertSame( 0, $result['athlete']['id'] );
		$this->assertSame( '', $result['athlete']['firstname'] );
	}

	/**
	 * Tests redeem code persists granted scope from proxy response.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_persists_scope(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode(
						array(
							'access_token' => 'access',
							'scope'        => 'read,activity:read_all',
						)
					),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->redeem_code( $state, 'code' );
		$this->assertSame( 'read,activity:read_all', $result['scope'] );
		$this->assertSame( 'read,activity:read_all', Block_For_Strava_OAuth::get_token( self::$user_id )['scope'] );
	}

	/**
	 * Tests refresh token no refresh token.
	 *
	 * @covers Block_For_Strava_OAuth::refresh_token
	 */
	public function test_refresh_token_no_refresh_token(): void {
		$oauth  = Block_For_Strava_OAuth::get_instance();
		$result = $oauth->refresh_token( self::$user_id, array() );
		$this->assertWPError( $result );
		$this->assertSame( 'no_refresh_token', $result->get_error_code() );
	}

	/**
	 * Tests refresh token proxy wp error.
	 *
	 * @covers Block_For_Strava_OAuth::refresh_token
	 */
	public function test_refresh_token_proxy_wp_error(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		add_filter(
			'pre_http_request',
			static function () {
				return new WP_Error( 'http_request_failed', 'fail' );
			}
		);
		$result = $oauth->refresh_token(
			self::$user_id,
			array( 'refresh_token' => 'r' )
		);
		$this->assertWPError( $result );
		$this->assertSame( 'proxy_request_failed', $result->get_error_code() );
	}

	/**
	 * Tests refresh token non 200.
	 *
	 * @covers Block_For_Strava_OAuth::refresh_token
	 */
	public function test_refresh_token_non_200(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 401 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);
		$result = $oauth->refresh_token(
			self::$user_id,
			array( 'refresh_token' => 'r' )
		);
		$this->assertWPError( $result );
		$this->assertSame( 'refresh_failed', $result->get_error_code() );
	}

	/**
	 * Tests refresh token success stores new token.
	 *
	 * @covers Block_For_Strava_OAuth::refresh_token
	 */
	public function test_refresh_token_success_stores_new_token(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode(
						array(
							'access_token'  => 'new-access',
							'refresh_token' => 'new-refresh',
							'expires_at'    => 99999,
						)
					),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->refresh_token(
			self::$user_id,
			array(
				'refresh_token' => 'old-refresh',
				'athlete'       => array( 'id' => 7 ),
			)
		);

		$this->assertIsArray( $result );
		$this->assertSame( 'new-access', $result['access_token'] );
		$this->assertSame( 'new-refresh', $result['refresh_token'] );
		$this->assertSame( 99999, $result['expires_at'] );
		$this->assertSame( 7, $result['athlete']['id'] );

		$this->assertSame( $result, Block_For_Strava_OAuth::get_token( self::$user_id ) );
	}

	/**
	 * Tests refresh token keeps old refresh when response omits it.
	 *
	 * @covers Block_For_Strava_OAuth::refresh_token
	 */
	public function test_refresh_token_keeps_old_refresh_when_response_omits_it(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'access_token' => 'new-access' ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->refresh_token(
			self::$user_id,
			array( 'refresh_token' => 'old-refresh' )
		);

		$this->assertSame( 'old-refresh', $result['refresh_token'] );
		$this->assertSame( 0, $result['expires_at'] );
		$this->assertSame( array(), $result['athlete'] );
	}

	/**
	 * Tests refresh token carries existing scope forward.
	 *
	 * @covers Block_For_Strava_OAuth::refresh_token
	 */
	public function test_refresh_token_carries_scope_forward(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'access_token' => 'new-access' ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->refresh_token(
			self::$user_id,
			array(
				'refresh_token' => 'r',
				'scope'         => 'read,activity:read_all',
			)
		);

		$this->assertSame( 'read,activity:read_all', $result['scope'] );
	}

	/**
	 * Tests has activity scope returns true when scope is unknown (legacy tokens).
	 *
	 * @covers Block_For_Strava_OAuth::has_activity_scope
	 */
	public function test_has_activity_scope_legacy_token(): void {
		$this->assertTrue( Block_For_Strava_OAuth::has_activity_scope( array( 'access_token' => 't' ) ) );
		$this->assertTrue( Block_For_Strava_OAuth::has_activity_scope( array( 'scope' => '' ) ) );
	}

	/**
	 * Tests has activity scope detects activity:read or activity:read_all.
	 *
	 * @covers Block_For_Strava_OAuth::has_activity_scope
	 */
	public function test_has_activity_scope_detects_activity_scopes(): void {
		$this->assertTrue( Block_For_Strava_OAuth::has_activity_scope( array( 'scope' => 'read activity:read_all' ) ) );
		$this->assertTrue( Block_For_Strava_OAuth::has_activity_scope( array( 'scope' => 'activity:read' ) ) );
		$this->assertTrue( Block_For_Strava_OAuth::has_activity_scope( array( 'scope' => 'profile:read_all,activity:read_all' ) ) );
	}

	/**
	 * Tests has activity scope returns false when only non-activity scopes are granted.
	 *
	 * @covers Block_For_Strava_OAuth::has_activity_scope
	 */
	public function test_has_activity_scope_false_without_activity_grants(): void {
		$this->assertFalse( Block_For_Strava_OAuth::has_activity_scope( array( 'scope' => 'read' ) ) );
		$this->assertFalse( Block_For_Strava_OAuth::has_activity_scope( array( 'scope' => 'profile:read_all' ) ) );
		$this->assertFalse( Block_For_Strava_OAuth::has_activity_scope( null ) );
	}

	/**
	 * Tests should_gate_callback_for_scope: only gate when scope is present and insufficient.
	 *
	 * @covers Block_For_Strava_OAuth::should_gate_callback_for_scope
	 */
	public function test_should_gate_callback_for_scope(): void {
		// Empty scope = legacy proxy did not forward; fall through, do not gate.
		$this->assertFalse( Block_For_Strava_OAuth::should_gate_callback_for_scope( '' ) );

		// Scope present and grants activity = let it through.
		$this->assertFalse( Block_For_Strava_OAuth::should_gate_callback_for_scope( 'read,activity:read_all' ) );
		$this->assertFalse( Block_For_Strava_OAuth::should_gate_callback_for_scope( 'activity:read' ) );

		// Scope present but lacks activity grant = gate the exchange.
		$this->assertTrue( Block_For_Strava_OAuth::should_gate_callback_for_scope( 'read' ) );
		$this->assertTrue( Block_For_Strava_OAuth::should_gate_callback_for_scope( 'profile:read_all' ) );
	}

	/**
	 * Tests scope_grants_activity for the raw-string callback gate.
	 *
	 * @covers Block_For_Strava_OAuth::scope_grants_activity
	 */
	public function test_scope_grants_activity_string_check(): void {
		$this->assertTrue( Block_For_Strava_OAuth::scope_grants_activity( 'read,activity:read_all' ) );
		$this->assertTrue( Block_For_Strava_OAuth::scope_grants_activity( 'activity:read' ) );
		$this->assertTrue( Block_For_Strava_OAuth::scope_grants_activity( 'read activity:read_all profile:read_all' ) );

		// Empty string at callback time = proxy did not forward scope; that is
		// not a grant by itself (the caller decides whether to fall through).
		$this->assertFalse( Block_For_Strava_OAuth::scope_grants_activity( '' ) );
		$this->assertFalse( Block_For_Strava_OAuth::scope_grants_activity( 'read' ) );
		$this->assertFalse( Block_For_Strava_OAuth::scope_grants_activity( 'profile:read_all' ) );
	}

	/**
	 * Tests redeem_code falls back to the callback scope when the proxy response omits it.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_uses_scope_fallback(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'access_token' => 'access' ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->redeem_code( $state, 'code', 'read,activity:read_all' );
		$this->assertSame( 'read,activity:read_all', $result['scope'] );
	}

	/**
	 * Tests redeem_code prefers the proxy response scope over the callback fallback.
	 *
	 * @covers Block_For_Strava_OAuth::redeem_code
	 */
	public function test_redeem_code_prefers_body_scope_over_fallback(): void {
		$oauth = Block_For_Strava_OAuth::get_instance();
		$state = $this->generate_state();

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode(
						array(
							'access_token' => 'access',
							'scope'        => 'activity:read_all',
						)
					),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = $oauth->redeem_code( $state, 'code', 'read' );
		$this->assertSame( 'activity:read_all', $result['scope'] );
	}

	/**
	 * Generates a state token tied to the editor user.
	 *
	 * @return string
	 */
	private function generate_state(): string {
		$state = wp_generate_password( 12, false );
		set_transient(
			Block_For_Strava_OAuth::STATE_TRANSIENT_PREFIX . $state,
			self::$user_id,
			MINUTE_IN_SECONDS
		);
		return $state;
	}
}
