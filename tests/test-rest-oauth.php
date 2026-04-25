<?php
/**
 * Tests for the OAuth + activity REST endpoints.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for /oauth/status, /oauth/authorize-url, /oauth/disconnect, /activities.
 */
class Test_Rest_OAuth extends WP_Test_REST_TestCase {

	/**
	 * Editor user ID.
	 *
	 * @var int
	 */
	protected static int $editor_id;

	/**
	 * Sets up test fixtures.
	 *
	 * @param WP_UnitTest_Factory $factory Factory instance.
	 */
	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ): void {
		self::$editor_id = $factory->user->create( array( 'role' => 'editor' ) );
	}

	/**
	 * Tears down test fixtures.
	 */
	public static function wpTearDownAfterClass(): void {
		self::delete_user( self::$editor_id );
	}

	/**
	 * Resets state between tests.
	 */
	public function tear_down(): void {
		Block_For_Strava_OAuth::delete_token( self::$editor_id );
		remove_all_filters( 'pre_http_request' );
		parent::tear_down();
	}

	/**
	 * Tests status disconnected.
	 *
	 * @covers Block_For_Strava::rest_oauth_status
	 */
	public function test_status_disconnected(): void {
		wp_set_current_user( self::$editor_id );
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/oauth/status' )
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['connected'] );
	}

	/**
	 * Tests status connected.
	 *
	 * @covers Block_For_Strava::rest_oauth_status
	 */
	public function test_status_connected(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
			array(
				'access_token' => 'token',
				'scope'        => 'read,activity:read_all',
				'athlete'      => array(
					'id'        => 7,
					'firstname' => 'Sam',
				),
			)
		);

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/oauth/status' )
		);
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertTrue( $data['connected'] );
		$this->assertSame( 7, $data['athlete']['id'] );
		$this->assertSame( 'read,activity:read_all', $data['scope'] );
		$this->assertTrue( $data['hasActivityScope'] );
	}

	/**
	 * Tests status reports missing activity scope.
	 *
	 * @covers Block_For_Strava::rest_oauth_status
	 */
	public function test_status_connected_without_activity_scope(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
			array(
				'access_token' => 'token',
				'scope'        => 'read',
			)
		);

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/oauth/status' )
		);
		$data     = $response->get_data();
		$this->assertSame( 'read', $data['scope'] );
		$this->assertFalse( $data['hasActivityScope'] );
	}

	/**
	 * Tests status connected without athlete.
	 *
	 * @covers Block_For_Strava::rest_oauth_status
	 */
	public function test_status_connected_without_athlete(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
			array( 'access_token' => 'token' )
		);

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/oauth/status' )
		);
		$this->assertSame( array(), $response->get_data()['athlete'] );
	}

	/**
	 * Tests status requires editor.
	 *
	 * @covers Block_For_Strava::editor_permission
	 * @covers Block_For_Strava::rest_oauth_status
	 */
	public function test_status_requires_editor(): void {
		wp_set_current_user( 0 );
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/oauth/status' )
		);
		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * Tests authorize url returns proxy url.
	 *
	 * @covers Block_For_Strava::rest_oauth_authorize_url
	 */
	public function test_authorize_url_returns_proxy_url(): void {
		wp_set_current_user( self::$editor_id );
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/oauth/authorize-url' )
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertStringContainsString( '/authorize?', $response->get_data()['url'] );
	}

	/**
	 * Tests disconnect clears token and posts to Strava's deauthorize endpoint.
	 *
	 * @covers Block_For_Strava::rest_oauth_disconnect
	 */
	public function test_disconnect_clears_token(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
			array( 'access_token' => 'token' )
		);

		$captured_url = '';
		add_filter(
			'pre_http_request',
			static function ( $preempt, $args, $url ) use ( &$captured_url ) {
				$captured_url = $url;
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

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', '/block-for-strava/v1/oauth/disconnect' )
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['connected'] );
		$this->assertNull( Block_For_Strava_OAuth::get_token( self::$editor_id ) );
		$this->assertStringStartsWith( 'https://www.strava.com/oauth/deauthorize', $captured_url );
		$this->assertStringContainsString( 'access_token=token', $captured_url );
	}

	/**
	 * Tests disconnect still clears the local token when Strava deauthorize fails.
	 *
	 * @covers Block_For_Strava::rest_oauth_disconnect
	 */
	public function test_disconnect_clears_token_when_deauthorize_fails(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
			array( 'access_token' => 'token' )
		);

		add_filter(
			'pre_http_request',
			static function () {
				return new WP_Error( 'http_request_failed', 'down' );
			}
		);

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'DELETE', '/block-for-strava/v1/oauth/disconnect' )
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( Block_For_Strava_OAuth::get_token( self::$editor_id ) );
	}

	/**
	 * Tests list activities when disconnected returns error.
	 *
	 * @covers Block_For_Strava::rest_list_activities
	 */
	public function test_list_activities_when_disconnected_returns_error(): void {
		wp_set_current_user( self::$editor_id );
		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/activities' )
		);
		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * Tests list activities returns normalized activities.
	 *
	 * @covers Block_For_Strava::rest_list_activities
	 */
	public function test_list_activities_returns_normalized_activities(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode(
						array(
							array(
								'id'               => 12345,
								'name'             => 'Morning Run',
								'type'             => 'Run',
								'distance'         => 5012.7,
								'start_date'       => '2026-04-21T08:00:00Z',
								'start_date_local' => '2026-04-21T10:00:00Z',
								'private'          => true,
							),
							array( 'name' => 'no-id, dropped' ),
							'not-an-array',
						)
					),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/activities' );
		$request->set_param( 'per_page', 5 );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$activities = $response->get_data()['activities'];
		$this->assertCount( 1, $activities );
		$this->assertSame( '12345', $activities[0]['id'] );
		$this->assertSame( 'Morning Run', $activities[0]['name'] );
		$this->assertSame( 'Run', $activities[0]['type'] );
		$this->assertSame( 5012.7, $activities[0]['distance'] );
		$this->assertSame( '2026-04-21T10:00:00Z', $activities[0]['startDate'] );
		$this->assertTrue( $activities[0]['private'] );
	}

	/**
	 * Tests list activities falls back to start_date when start_date_local is missing.
	 *
	 * @covers Block_For_Strava::rest_list_activities
	 */
	public function test_list_activities_falls_back_to_start_date(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);

		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode(
						array(
							array(
								'id'         => 99,
								'start_date' => '2026-04-21T08:00:00Z',
							),
						)
					),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$response   = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/activities' )
		);
		$activities = $response->get_data()['activities'];
		$this->assertSame( '2026-04-21T08:00:00Z', $activities[0]['startDate'] );
	}

	/**
	 * Tests list activities handles non array response.
	 *
	 * @covers Block_For_Strava::rest_list_activities
	 */
	public function test_list_activities_handles_non_array_response(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
			array(
				'access_token' => 'token',
				'expires_at'   => time() + 3600,
			)
		);
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'response' => array( 'code' => 200 ),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary( array() ),
					'body'     => wp_json_encode( null ),
					'cookies'  => array(),
					'filename' => '',
				);
			}
		);

		$response = rest_get_server()->dispatch(
			new WP_REST_Request( 'GET', '/block-for-strava/v1/activities' )
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), $response->get_data()['activities'] );
	}

	/**
	 * Tests list activities clamps per page and page.
	 *
	 * @covers Block_For_Strava::rest_list_activities
	 */
	public function test_list_activities_clamps_per_page_and_page(): void {
		wp_set_current_user( self::$editor_id );
		Block_For_Strava_OAuth::set_token(
			self::$editor_id,
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

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/activities' );
		$request->set_param( 'per_page', 999 );
		$request->set_param( 'page', 0 );
		rest_get_server()->dispatch( $request );

		$this->assertStringContainsString( 'per_page=30', $captured );
		$this->assertStringContainsString( 'page=1', $captured );
	}
}
