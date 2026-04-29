<?php
/**
 * Tests for Block_For_Strava_Embed::parse_strava_url().
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for Block_For_Strava_Embed::parse_strava_url().
 */
class Test_Parse_Strava_Url extends WP_UnitTestCase {

	/**
	 * Tests parsing a canonical activity URL.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_activity_url(): void {
		$this->assertSame(
			array(
				'type' => 'activity',
				'id'   => '18233733854',
			),
			Block_For_Strava_Embed::parse_strava_url( 'https://www.strava.com/activities/18233733854' )
		);
	}

	/**
	 * Tests parsing a canonical route URL.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_route_url(): void {
		$this->assertSame(
			array(
				'type' => 'route',
				'id'   => '12345',
			),
			Block_For_Strava_Embed::parse_strava_url( 'https://www.strava.com/routes/12345' )
		);
	}

	/**
	 * Tests parsing a canonical segment URL.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_segment_url(): void {
		$this->assertSame(
			array(
				'type' => 'segment',
				'id'   => '67890',
			),
			Block_For_Strava_Embed::parse_strava_url( 'https://www.strava.com/segments/67890' )
		);
	}

	/**
	 * Tests that an activity URL with query args still parses.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_activity_url_with_query_args(): void {
		$this->assertSame(
			array(
				'type' => 'activity',
				'id'   => '18233733854',
			),
			Block_For_Strava_Embed::parse_strava_url(
				'https://www.strava.com/activities/18233733854?utm_source=ios_share'
			)
		);
	}

	/**
	 * Tests that an unrelated URL returns false.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_unrelated_url_returns_false(): void {
		$this->assertFalse(
			Block_For_Strava_Embed::parse_strava_url( 'https://example.com/activities/123' )
		);
	}

	/**
	 * Tests that a look-alike host (e.g. evilstrava.com) is rejected.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_lookalike_host_returns_false(): void {
		$this->assertFalse(
			Block_For_Strava_Embed::parse_strava_url( 'https://evilstrava.com/activities/123' )
		);
		$this->assertFalse(
			Block_For_Strava_Embed::parse_strava_url( 'https://strava.com.evil.example/activities/123' )
		);
	}

	/**
	 * Tests that bare strava.com (no subdomain) is accepted.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_bare_strava_host_is_accepted(): void {
		$this->assertSame(
			array(
				'type' => 'activity',
				'id'   => '42',
			),
			Block_For_Strava_Embed::parse_strava_url( 'https://strava.com/activities/42' )
		);
	}

	/**
	 * Tests that a non-www Strava subdomain is accepted.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_non_www_subdomain_is_accepted(): void {
		$this->assertSame(
			array(
				'type' => 'activity',
				'id'   => '42',
			),
			Block_For_Strava_Embed::parse_strava_url( 'https://app.strava.com/activities/42' )
		);
	}

	/**
	 * Tests that a URL whose path merely contains the literal string
	 * "strava.com/activities/123" (e.g. as a redirect target) is rejected.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_substring_in_path_returns_false(): void {
		$this->assertFalse(
			Block_For_Strava_Embed::parse_strava_url(
				'https://example.com/redirect?to=strava.com/activities/123'
			)
		);
	}

	/**
	 * Tests that a short URL returns false (canonical only).
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_short_url_returns_false(): void {
		$this->assertFalse(
			Block_For_Strava_Embed::parse_strava_url( 'https://strava.app.link/nTuKEiCsA2b' )
		);
	}

	/**
	 * Tests that an empty string returns false.
	 *
	 * @covers Block_For_Strava_Embed::parse_strava_url
	 */
	public function test_empty_string_returns_false(): void {
		$this->assertFalse( Block_For_Strava_Embed::parse_strava_url( '' ) );
	}
}
