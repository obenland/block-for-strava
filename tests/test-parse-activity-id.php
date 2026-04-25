<?php
/**
 * Tests for block_for_strava_parse_activity_id().
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for block_for_strava_parse_activity_id().
 */
class Test_Parse_Activity_Id extends WP_UnitTestCase {

	/**
	 * Tests parsing a canonical activity URL.
	 *
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_canonical_url(): void {
		$this->assertSame(
			'18233733854',
			block_for_strava_parse_activity_id( 'https://www.strava.com/activities/18233733854' )
		);
	}

	/**
	 * Tests parsing a canonical URL with query arguments.
	 *
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
	 * Tests that a short URL returns false.
	 *
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_short_url_returns_false(): void {
		$this->assertFalse(
			block_for_strava_parse_activity_id( 'https://strava.app.link/nTuKEiCsA2b' )
		);
	}

	/**
	 * Tests that an unrelated URL returns false.
	 *
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_unrelated_url_returns_false(): void {
		$this->assertFalse(
			block_for_strava_parse_activity_id( 'https://example.com/activities/123' )
		);
	}

	/**
	 * Tests that an empty string returns false.
	 *
	 * @covers ::block_for_strava_parse_activity_id
	 */
	public function test_empty_string_returns_false(): void {
		$this->assertFalse( block_for_strava_parse_activity_id( '' ) );
	}
}
