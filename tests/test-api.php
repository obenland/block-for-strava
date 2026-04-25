<?php
/**
 * Tests for the Block_For_Strava_API class.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for the Strava API client.
 */
class Test_API extends WP_UnitTestCase {

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
	 * Resets state between tests.
	 */
	public function tear_down(): void {
		Block_For_Strava_OAuth::delete_token( self::$user_id );
		remove_all_filters( 'pre_http_request' );
		parent::tear_down();
	}

	/**
	 * Tests request without token returns error.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_without_token_returns_error(): void {
		$result = Block_For_Strava_API::request( self::$user_id, 'athlete' );
		$this->assertWPError( $result );
		$this->assertSame( 'not_connected', $result->get_error_code() );
	}

	/**
	 * Tests get athlete success.
	 *
	 * @covers Block_For_Strava_API::request
	 * @covers Block_For_Strava_API::get_athlete
	 */
	public function test_get_athlete_success(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token'  => 'token',
				'refresh_token' => 'r',
				'expires_at'    => time() + 3600,
				'athlete'       => array(),
			)
		);

		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) {
				if ( str_contains( $url, '/api/v3/athlete' ) ) {
					return array(
						'response' => array( 'code' => 200 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => wp_json_encode( array( 'id' => 99 ) ),
						'cookies'  => array(),
						'filename' => '',
					);
				}
				return $preempt;
			},
			10,
			3
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertIsArray( $result );
		$this->assertSame( 99, $result['id'] );
	}

	/**
	 * Tests get activities passes query args.
	 *
	 * @covers Block_For_Strava_API::get_activities
	 */
	public function test_get_activities_passes_query_args(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		$captured = '';
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$captured ) {
				$captured = $url;
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array() ),
					'cookies'  => array(),
					'filename' => '',
				);
			},
			10,
			3
		);

		Block_For_Strava_API::get_activities( self::$user_id, array( 'per_page' => 5 ) );
		$this->assertStringContainsString( 'per_page=5', $captured );
		$this->assertStringContainsString( '/athlete/activities', $captured );
	}

	/**
	 * Tests get activity uses path.
	 *
	 * @covers Block_For_Strava_API::get_activity
	 */
	public function test_get_activity_uses_path(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		$captured = '';
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$captured ) {
				$captured = $url;
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'id' => 12345 ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			},
			10,
			3
		);

		$result = Block_For_Strava_API::get_activity( self::$user_id, '12345' );
		$this->assertSame( 12345, $result['id'] );
		$this->assertStringContainsString( '/activities/12345', $captured );
	}

	/**
	 * Tests request refreshes expired token before calling.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_refreshes_expired_token_before_calling(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token'  => 'old',
				'refresh_token' => 'r',
				'expires_at'    => time() - 10,
			)
		);

		$auth_headers = array();
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$auth_headers ) {
				if ( str_contains( $url, '/refresh' ) ) {
					return array(
						'response' => array( 'code' => 200 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => wp_json_encode(
							array(
								'access_token' => 'new',
								'expires_at'   => time() + 3600,
							)
						),
						'cookies'  => array(),
						'filename' => '',
					);
				}
				$auth_headers[] = $args['headers']['Authorization'] ?? '';
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'ok' => true ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			},
			10,
			3
		);

		Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertSame( array( 'Bearer new' ), $auth_headers );
	}

	/**
	 * Tests request returns error when proactive refresh fails.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_error_when_proactive_refresh_fails(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token'  => 'old',
				'refresh_token' => 'r',
				'expires_at'    => time() - 10,
			)
		);

		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) {
				if ( str_contains( $url, '/refresh' ) ) {
					return array(
						'response' => array( 'code' => 401 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => '',
						'cookies'  => array(),
						'filename' => '',
					);
				}
				return $preempt;
			},
			10,
			3
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'refresh_failed', $result->get_error_code() );
		$this->assertNull( Block_For_Strava_OAuth::get_token( self::$user_id ) );
	}

	/**
	 * Tests request retries after 401 with refreshed token.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_retries_after_401_with_refreshed_token(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token'  => 'old',
				'refresh_token' => 'r',
				'expires_at'    => time() + 3600,
			)
		);

		$call = 0;
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$call ) {
				if ( str_contains( $url, '/refresh' ) ) {
					return array(
						'response' => array( 'code' => 200 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => wp_json_encode(
							array(
								'access_token' => 'new',
								'expires_at'   => time() + 3600,
							)
						),
						'cookies'  => array(),
						'filename' => '',
					);
				}
				++$call;
				if ( 1 === $call ) {
					return array(
						'response' => array( 'code' => 401 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => wp_json_encode( array( 'message' => 'Auth' ) ),
						'cookies'  => array(),
						'filename' => '',
					);
				}
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'id' => 5 ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			},
			10,
			3
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertIsArray( $result );
		$this->assertSame( 5, $result['id'] );
	}

	/**
	 * Tests request returns error when post 401 refresh fails.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_error_when_post_401_refresh_fails(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token'  => 'old',
				'refresh_token' => 'r',
				'expires_at'    => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) {
				if ( str_contains( $url, '/refresh' ) ) {
					return array(
						'response' => array( 'code' => 500 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => '',
						'cookies'  => array(),
						'filename' => '',
					);
				}
				return array(
					'response' => array( 'code' => 401 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			},
			10,
			3
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'refresh_failed', $result->get_error_code() );
		$this->assertNull( Block_For_Strava_OAuth::get_token( self::$user_id ) );
	}

	/**
	 * Tests request purges token when 401 persists after a successful refresh.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_purges_token_on_persistent_401(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token'  => 'old',
				'refresh_token' => 'r',
				'expires_at'    => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) {
				if ( str_contains( $url, '/refresh' ) ) {
					return array(
						'response' => array( 'code' => 200 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => wp_json_encode(
							array(
								'access_token' => 'new',
								'expires_at'   => time() + 3600,
							)
						),
						'cookies'  => array(),
						'filename' => '',
					);
				}
				return array(
					'response' => array( 'code' => 401 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			},
			10,
			3
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'strava_api_error', $result->get_error_code() );
		$this->assertNull( Block_For_Strava_OAuth::get_token( self::$user_id ) );
	}

	/**
	 * Tests request returns wp error from first call.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_wp_error_from_first_call(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return new WP_Error( 'http_request_failed', 'down' );
			}
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'http_request_failed', $result->get_error_code() );
	}

	/**
	 * Tests request returns wp error from retry call.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_wp_error_from_retry_call(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token'  => 'token',
				'refresh_token' => 'r',
				'expires_at'    => time() + 3600,
			)
		);

		$call = 0;
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$call ) {
				if ( str_contains( $url, '/refresh' ) ) {
					return array(
						'response' => array( 'code' => 200 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => wp_json_encode( array( 'access_token' => 'new' ) ),
						'cookies'  => array(),
						'filename' => '',
					);
				}
				++$call;
				if ( 1 === $call ) {
					return array(
						'response' => array( 'code' => 401 ),
						'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
						'body'     => '',
						'cookies'  => array(),
						'filename' => '',
					);
				}
				return new WP_Error( 'http_request_failed', 'down' );
			},
			10,
			3
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'http_request_failed', $result->get_error_code() );
	}

	/**
	 * Tests request returns strava error with message.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_strava_error_with_message(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 404 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'message' => 'Record Not Found' ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = Block_For_Strava_API::get_activity( self::$user_id, '999' );
		$this->assertWPError( $result );
		$this->assertSame( 'strava_api_error', $result->get_error_code() );
		$this->assertSame( 'Record Not Found', $result->get_error_message() );
	}

	/**
	 * Tests request returns forbidden error code on 403.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_forbidden_on_403(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 403 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( array( 'message' => 'Forbidden' ) ),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'strava_forbidden', $result->get_error_code() );
		$this->assertSame( 403, $result->get_error_data()['status'] );
	}

	/**
	 * Tests request returns forbidden with a default message when Strava omits one.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_forbidden_on_403_without_message(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 403 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'strava_forbidden', $result->get_error_code() );
		$this->assertNotEmpty( $result->get_error_message() );
	}

	/**
	 * Tests request returns rate-limited error on 429.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_rate_limited_on_429(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 429 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'strava_rate_limited', $result->get_error_code() );
		$this->assertSame( 429, $result->get_error_data()['status'] );
	}

	/**
	 * Tests deauthorize is a no-op without a token.
	 *
	 * @covers Block_For_Strava_API::deauthorize
	 */
	public function test_deauthorize_no_op_without_token(): void {
		$called = false;
		add_filter(
			'pre_http_request',
			static function () use ( &$called ) {
				$called = true;
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		Block_For_Strava_API::deauthorize( self::$user_id );
		$this->assertFalse( $called );
	}

	/**
	 * Tests deauthorize posts to Strava's OAuth root with the access token in the query string.
	 *
	 * @covers Block_For_Strava_API::deauthorize
	 */
	public function test_deauthorize_posts_with_access_token_query(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'tok-123',
				'expires_at'   => time() + 3600,
			)
		);

		$captured_url    = '';
		$captured_method = '';
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$captured_url, &$captured_method ) {
				$captured_url    = $url;
				$captured_method = $args['method'] ?? '';
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			},
			10,
			3
		);

		Block_For_Strava_API::deauthorize( self::$user_id );
		$this->assertSame(
			'https://www.strava.com/oauth/deauthorize?access_token=tok-123',
			$captured_url
		);
		$this->assertSame( 'POST', $captured_method );
	}

	/**
	 * Tests deauthorize swallows HTTP failures.
	 *
	 * @covers Block_For_Strava_API::deauthorize
	 */
	public function test_deauthorize_swallows_failures(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'tok-123',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return new WP_Error( 'http_request_failed', 'down' );
			}
		);

		Block_For_Strava_API::deauthorize( self::$user_id );
		$this->assertTrue( true );
	}

	/**
	 * Tests request returns generic error without message.
	 *
	 * @covers Block_For_Strava_API::request
	 */
	public function test_request_returns_generic_error_without_message(): void {
		Block_For_Strava_OAuth::set_token(
			self::$user_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 500 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => 'oops',
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$result = Block_For_Strava_API::get_athlete( self::$user_id );
		$this->assertWPError( $result );
		$this->assertSame( 'strava_api_error', $result->get_error_code() );
	}
}
