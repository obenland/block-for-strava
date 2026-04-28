<?php
/**
 * Tests for block_for_strava_parse_strava_url().
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for block_for_strava_parse_strava_url().
 */
class Test_Parse_Strava_Url extends WP_UnitTestCase {

	/**
	 * Tests parsing a canonical activity URL.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_activity_url(): void {
		$this->assertSame(
			array(
				'type' => 'activity',
				'id'   => '18233733854',
			),
			block_for_strava_parse_strava_url( 'https://www.strava.com/activities/18233733854' )
		);
	}

	/**
	 * Tests parsing a canonical route URL.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_route_url(): void {
		$this->assertSame(
			array(
				'type' => 'route',
				'id'   => '12345',
			),
			block_for_strava_parse_strava_url( 'https://www.strava.com/routes/12345' )
		);
	}

	/**
	 * Tests parsing a canonical segment URL.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_segment_url(): void {
		$this->assertSame(
			array(
				'type' => 'segment',
				'id'   => '67890',
			),
			block_for_strava_parse_strava_url( 'https://www.strava.com/segments/67890' )
		);
	}

	/**
	 * Tests that an activity URL with query args still parses.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_activity_url_with_query_args(): void {
		$this->assertSame(
			array(
				'type' => 'activity',
				'id'   => '18233733854',
			),
			block_for_strava_parse_strava_url(
				'https://www.strava.com/activities/18233733854?utm_source=ios_share'
			)
		);
	}

	/**
	 * Tests that an unrelated URL returns false.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_unrelated_url_returns_false(): void {
		$this->assertFalse(
			block_for_strava_parse_strava_url( 'https://example.com/activities/123' )
		);
	}

	/**
	 * Tests that a look-alike host (e.g. evilstrava.com) is rejected.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_lookalike_host_returns_false(): void {
		$this->assertFalse(
			block_for_strava_parse_strava_url( 'https://evilstrava.com/activities/123' )
		);
		$this->assertFalse(
			block_for_strava_parse_strava_url( 'https://strava.com.evil.example/activities/123' )
		);
	}

	/**
	 * Tests that bare strava.com (no subdomain) is accepted.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_bare_strava_host_is_accepted(): void {
		$this->assertSame(
			array(
				'type' => 'activity',
				'id'   => '42',
			),
			block_for_strava_parse_strava_url( 'https://strava.com/activities/42' )
		);
	}

	/**
	 * Tests that a non-www Strava subdomain is accepted.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_non_www_subdomain_is_accepted(): void {
		$this->assertSame(
			array(
				'type' => 'activity',
				'id'   => '42',
			),
			block_for_strava_parse_strava_url( 'https://app.strava.com/activities/42' )
		);
	}

	/**
	 * Tests that a URL whose path merely contains the literal string
	 * "strava.com/activities/123" (e.g. as a redirect target) is rejected.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_substring_in_path_returns_false(): void {
		$this->assertFalse(
			block_for_strava_parse_strava_url(
				'https://example.com/redirect?to=strava.com/activities/123'
			)
		);
	}

	/**
	 * Tests that a short URL returns false (canonical only).
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_short_url_returns_false(): void {
		$this->assertFalse(
			block_for_strava_parse_strava_url( 'https://strava.app.link/nTuKEiCsA2b' )
		);
	}

	/**
	 * Tests that an empty string returns false.
	 *
	 * @covers ::block_for_strava_parse_strava_url
	 */
	public function test_empty_string_returns_false(): void {
		$this->assertFalse( block_for_strava_parse_strava_url( '' ) );
	}

	/**
	 * Tests that block_for_strava_parse_activity_id still returns just the id
	 * for activity URLs (back-compat) and false for routes/segments.
	 *
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_parse_activity_id_back_compat(): void {
		$this->assertSame(
			'18233733854',
			block_for_strava_parse_activity_id( 'https://www.strava.com/activities/18233733854' )
		);
		$this->assertFalse(
			block_for_strava_parse_activity_id( 'https://www.strava.com/routes/12345' )
		);
		$this->assertFalse(
			block_for_strava_parse_activity_id( 'https://www.strava.com/segments/67890' )
		);
	}
}
