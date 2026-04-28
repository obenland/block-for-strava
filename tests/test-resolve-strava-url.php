<?php
/**
 * Tests for block_for_strava_resolve_strava_url().
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for block_for_strava_resolve_strava_url().
 */
class Test_Resolve_Strava_Url extends WP_UnitTestCase {

	/**
	 * Tests that a non-short URL returns an error.
	 *
	 * @covers ::block_for_strava_resolve_strava_url
	 */
	public function test_non_short_url_returns_error(): void {
		$result = block_for_strava_resolve_strava_url( 'https://www.strava.com/activities/123' );
		$this->assertWPError( $result );
		$this->assertSame( 'unsupported_url', $result->get_error_code() );
	}

	/**
	 * Tests resolving a short URL via a redirect.
	 *
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
		try {
			$result = block_for_strava_resolve_strava_url( 'https://strava.app.link/nTuKEiCsA2b' );
		} finally {
			remove_filter( 'pre_http_request', $callback );
		}

		$this->assertSame( 'https://www.strava.com/activities/18233733854', $result );
	}

	/**
	 * Tests that a network failure returns an error.
	 *
	 * @covers ::block_for_strava_resolve_strava_url
	 */
	public function test_network_failure_returns_error(): void {
		$callback = static function () {
			return new WP_Error( 'http_request_failed', 'Connection refused.' );
		};
		add_filter( 'pre_http_request', $callback );

		try {
			$result = block_for_strava_resolve_strava_url( 'https://strava.app.link/nTuKEiCsA2b' );
		} finally {
			remove_filter( 'pre_http_request', $callback );
		}

		$this->assertWPError( $result );
		$this->assertSame( 'request_failed', $result->get_error_code() );
	}
}
