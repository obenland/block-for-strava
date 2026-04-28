<?php
/**
 * Tests for the REST API endpoint.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for the block-for-strava/v1/resolve REST endpoint.
 */
class Test_Rest_Resolve extends WP_Test_REST_TestCase {

	/**
	 * ID of the editor user.
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
	 * Tests that a canonical URL resolves to the activity ID.
	 *
	 * @covers Block_For_Strava::rest_resolve_url
	 */
	public function test_resolves_canonical_url(): void {
		wp_set_current_user( self::$editor_id );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/resolve' );
		$request->set_param( 'url', 'https://www.strava.com/activities/18233733854' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( 'activityId', 'embedType' ), array_keys( $response->get_data() ) );
		$this->assertSame( '18233733854', $response->get_data()['activityId'] );
		$this->assertSame( 'activity', $response->get_data()['embedType'] );
	}

	/**
	 * Tests that a canonical route URL resolves with embedType=route.
	 *
	 * @covers Block_For_Strava::rest_resolve_url
	 */
	public function test_resolves_route_url(): void {
		wp_set_current_user( self::$editor_id );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/resolve' );
		$request->set_param( 'url', 'https://www.strava.com/routes/12345' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '12345', $response->get_data()['activityId'] );
		$this->assertSame( 'route', $response->get_data()['embedType'] );
	}

	/**
	 * Tests that a canonical segment URL resolves with embedType=segment.
	 *
	 * @covers Block_For_Strava::rest_resolve_url
	 */
	public function test_resolves_segment_url(): void {
		wp_set_current_user( self::$editor_id );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/resolve' );
		$request->set_param( 'url', 'https://www.strava.com/segments/67890' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '67890', $response->get_data()['activityId'] );
		$this->assertSame( 'segment', $response->get_data()['embedType'] );
	}

	/**
	 * Tests that a non-Strava URL returns a 400 error.
	 *
	 * @covers Block_For_Strava::rest_resolve_url
	 */
	public function test_rejects_non_strava_url(): void {
		wp_set_current_user( self::$editor_id );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/resolve' );
		$request->set_param( 'url', 'https://example.com/activities/123' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * Tests resolving a short Strava URL to an activity ID.
	 *
	 * @covers Block_For_Strava::rest_resolve_url
	 */
	public function test_resolves_short_url(): void {
		wp_set_current_user( self::$editor_id );

		$callback = static function ( $preempt, $args, $url ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				return array(
					'response' => array(
						'code'    => 302,
						'message' => 'Found',
					),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary(
						array( 'location' => 'https://www.strava.com/activities/99999' )
					),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};

		add_filter( 'pre_http_request', $callback, 10, 3 );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/resolve' );
		$request->set_param( 'url', 'https://strava.app.link/nTuKEiCsA2b' );
		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'pre_http_request', $callback, 10 );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '99999', $response->get_data()['activityId'] );
		$this->assertSame( 'activity', $response->get_data()['embedType'] );
	}

	/**
	 * Tests that unauthenticated requests are rejected.
	 *
	 * @covers Block_For_Strava::rest_resolve_url
	 */
	public function test_requires_authentication(): void {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/resolve' );
		$request->set_param( 'url', 'https://www.strava.com/activities/123' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 401, $response->get_status() );
	}
}
