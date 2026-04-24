<?php
/**
 * Tests for functions.php.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for block_for_strava_parse_activity_id().
 */
class Test_Parse_Activity_Id extends WP_UnitTestCase {

	/**
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_canonical_url(): void {
		$this->assertSame(
			'18233733854',
			block_for_strava_parse_activity_id( 'https://www.strava.com/activities/18233733854' )
		);
	}

	/**
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_canonical_url_with_query_args(): void {
		$this->assertSame(
			'18233733854',
			block_for_strava_parse_activity_id(
				'https://www.strava.com/activities/18233733854?utm_source=ios_share&utm_medium=social'
			)
		);
	}

	/**
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_short_url_returns_false(): void {
		$this->assertFalse(
			block_for_strava_parse_activity_id( 'https://strava.app.link/nTuKEiCsA2b' )
		);
	}

	/**
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_unrelated_url_returns_false(): void {
		$this->assertFalse(
			block_for_strava_parse_activity_id( 'https://example.com/activities/123' )
		);
	}

	/**
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_empty_string_returns_false(): void {
		$this->assertFalse( block_for_strava_parse_activity_id( '' ) );
	}
}

/**
 * Tests for block_for_strava_resolve_strava_url().
 */
class Test_Resolve_Strava_Url extends WP_UnitTestCase {

	/**
	 * @covers ::block_for_strava_resolve_strava_url
	 */
	public function test_non_short_url_returns_error(): void {
		$result = block_for_strava_resolve_strava_url( 'https://www.strava.com/activities/123' );
		$this->assertWPError( $result );
		$this->assertSame( 'unsupported_url', $result->get_error_code() );
	}

	/**
	 * @covers ::block_for_strava_resolve_strava_url
	 */
	public function test_resolves_short_url_via_redirect(): void {
		$callback = static function ( $preempt, $args, $url ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				return array(
					'response' => array(
						'code'    => 302,
						'message' => 'Found',
					),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary(
						array( 'location' => 'https://www.strava.com/activities/18233733854' )
					),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};

		add_filter( 'pre_http_request', $callback, 10, 3 );
		$result = block_for_strava_resolve_strava_url( 'https://strava.app.link/nTuKEiCsA2b' );
		remove_filter( 'pre_http_request', $callback, 10 );

		$this->assertSame( 'https://www.strava.com/activities/18233733854', $result );
	}

	/**
	 * @covers ::block_for_strava_resolve_strava_url
	 */
	public function test_network_failure_returns_error(): void {
		$callback = static function () {
			return new WP_Error( 'http_request_failed', 'Connection refused.' );
		};

		add_filter( 'pre_http_request', $callback );
		$result = block_for_strava_resolve_strava_url( 'https://strava.app.link/nTuKEiCsA2b' );
		remove_filter( 'pre_http_request', $callback );

		$this->assertWPError( $result );
		$this->assertSame( 'request_failed', $result->get_error_code() );
	}
}
