<?php
/**
 * Tests for block_for_strava_resolve_url().
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for block_for_strava_resolve_url().
 */
class Test_Resolve_Strava_Url extends WP_UnitTestCase {

	/**
	 * Tests that a non-short URL returns an error.
	 *
	 * @covers ::block_for_strava_resolve_url
	 */
	public function test_non_short_url_returns_error(): void {
		$result = block_for_strava_resolve_url( 'https://www.strava.com/activities/123' );
		$this->assertWPError( $result );
		$this->assertSame( 'unsupported_url', $result->get_error_code() );
	}

	/**
	 * Tests resolving a short URL via a redirect.
	 *
	 * @covers ::block_for_strava_resolve_url
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
			$result = block_for_strava_resolve_url( 'https://strava.app.link/nTuKEiCsA2b' );
		} finally {
			remove_filter( 'pre_http_request', $callback );
		}

		$this->assertSame( 'https://www.strava.com/activities/18233733854', $result );
	}

	/**
	 * Tests that a network failure returns an error.
	 *
	 * @covers ::block_for_strava_resolve_url
	 */
	public function test_network_failure_returns_error(): void {
		$callback = static function () {
			return new WP_Error( 'http_request_failed', 'Connection refused.' );
		};
		add_filter( 'pre_http_request', $callback );

		try {
			$result = block_for_strava_resolve_url( 'https://strava.app.link/nTuKEiCsA2b' );
		} finally {
			remove_filter( 'pre_http_request', $callback );
		}

		$this->assertWPError( $result );
		$this->assertSame( 'request_failed', $result->get_error_code() );
	}

	/**
	 * Tests that a host whose name merely ends with the literal allowlist string
	 * (e.g. `evilstrava.app.link`) is rejected. Guards against suffix-match bypass.
	 *
	 * @covers ::block_for_strava_resolve_url
	 */
	public function test_rejects_host_suffix_bypass(): void {
		$result = block_for_strava_resolve_url( 'https://evilstrava.app.link/foo' );
		$this->assertWPError( $result );
		$this->assertSame( 'unsupported_url', $result->get_error_code() );
	}

	/**
	 * Tests that a non-http(s) scheme on the input URL is rejected.
	 *
	 * @covers ::block_for_strava_resolve_url
	 */
	public function test_rejects_non_http_scheme(): void {
		$result = block_for_strava_resolve_url( 'ftp://strava.app.link/foo' );
		$this->assertWPError( $result );
		$this->assertSame( 'unsupported_url', $result->get_error_code() );
	}

	/**
	 * Tests that a redirect to a host outside the Strava allowlist is not followed,
	 * preventing the resolver from being used to issue requests against attacker-chosen
	 * hosts (SSRF via redirect chain).
	 *
	 * @covers ::block_for_strava_resolve_url
	 */
	public function test_rejects_redirect_to_disallowed_host(): void {
		$callback = static function ( $preempt, $args, $url ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				return array(
					'response' => array(
						'code'    => 302,
						'message' => 'Found',
					),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary(
						array( 'location' => 'http://127.0.0.1:8080/internal' )
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
			$result = block_for_strava_resolve_url( 'https://strava.app.link/nTuKEiCsA2b' );
		} finally {
			remove_filter( 'pre_http_request', $callback, 10 );
		}

		$this->assertWPError( $result );
		$this->assertSame( 'resolution_failed', $result->get_error_code() );
	}

	/**
	 * Tests that a redirect to a host that merely ends with the literal allowlist string
	 * (e.g. `evilstrava.com`) is not followed.
	 *
	 * @covers ::block_for_strava_resolve_url
	 */
	public function test_rejects_redirect_to_suffix_bypass_host(): void {
		$callback = static function ( $preempt, $args, $url ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				return array(
					'response' => array(
						'code'    => 302,
						'message' => 'Found',
					),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary(
						array( 'location' => 'https://evilstrava.com/activities/123' )
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
			$result = block_for_strava_resolve_url( 'https://strava.app.link/nTuKEiCsA2b' );
		} finally {
			remove_filter( 'pre_http_request', $callback, 10 );
		}

		$this->assertWPError( $result );
		$this->assertSame( 'resolution_failed', $result->get_error_code() );
	}

	/**
	 * Tests that the resolver uses wp_safe_remote_head() (not wp_remote_head()),
	 * which is the second SSRF defense layer that blocks private/loopback IPs at
	 * the HTTP layer. Asserts that `reject_unsafe_urls` is set on the request.
	 *
	 * @covers ::block_for_strava_resolve_url
	 */
	public function test_uses_safe_http_for_redirect_fetch(): void {
		$captured_args = null;
		$callback      = static function ( $preempt, $args, $url ) use ( &$captured_args ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				$captured_args = $args;
				return array(
					'response' => array(
						'code'    => 302,
						'message' => 'Found',
					),
					'headers'  => new Requests_Utility_CaseInsensitiveDictionary(
						array( 'location' => 'https://www.strava.com/activities/123' )
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
			block_for_strava_resolve_url( 'https://strava.app.link/nTuKEiCsA2b' );
		} finally {
			remove_filter( 'pre_http_request', $callback, 10 );
		}

		$this->assertIsArray( $captured_args );
		$this->assertArrayHasKey( 'reject_unsafe_urls', $captured_args );
		$this->assertTrue( $captured_args['reject_unsafe_urls'] );
	}
}
