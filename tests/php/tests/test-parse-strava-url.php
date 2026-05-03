<?php
/**
 * Tests for block_for_strava_parse_url().
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for block_for_strava_parse_url().
 */
class Test_Parse_Strava_Url extends WP_UnitTestCase {

	/**
	 * Provides canonical Strava URLs that must parse to a {type, id} pair.
	 *
	 * @return array<string, array{0: string, 1: array{type: string, id: string}}>
	 */
	public static function provide_parsing_urls(): array {
		return array(
			'activity URL'                 => array(
				'https://www.strava.com/activities/18233733854',
				array(
					'type' => 'activity',
					'id'   => '18233733854',
				),
			),
			'route URL'                    => array(
				'https://www.strava.com/routes/12345',
				array(
					'type' => 'route',
					'id'   => '12345',
				),
			),
			'segment URL'                  => array(
				'https://www.strava.com/segments/67890',
				array(
					'type' => 'segment',
					'id'   => '67890',
				),
			),
			'activity URL with query args' => array(
				'https://www.strava.com/activities/18233733854?utm_source=ios_share',
				array(
					'type' => 'activity',
					'id'   => '18233733854',
				),
			),
			'bare strava.com host'         => array(
				'https://strava.com/activities/42',
				array(
					'type' => 'activity',
					'id'   => '42',
				),
			),
			'non-www subdomain'            => array(
				'https://app.strava.com/activities/42',
				array(
					'type' => 'activity',
					'id'   => '42',
				),
			),
			'upper-case scheme + host'     => array(

				/*
				 * `wp_parse_url` doesn't normalize host case, but the
				 * implementation lower-cases the host before its own
				 * suffix checks. Pin that round-trip so a future "drop
				 * the strtolower" pass fails this test instead of
				 * silently breaking URLs pasted from clipboard tools
				 * that capitalize hosts.
				 */
				'HTTPS://WWW.STRAVA.COM/activities/123',
				array(
					'type' => 'activity',
					'id'   => '123',
				),
			),
		);
	}

	/**
	 * Tests that canonical Strava URLs parse to the expected {type, id}.
	 *
	 * @dataProvider provide_parsing_urls
	 *
	 * @param string                          $url      Input URL.
	 * @param array{type: string, id: string} $expected Expected parse result.
	 *
	 * @covers ::block_for_strava_parse_url
	 */
	public function test_parses_canonical_url( string $url, array $expected ): void {
		$this->assertSame( $expected, block_for_strava_parse_url( $url ) );
	}

	/**
	 * Provides URLs that must NOT parse (return false).
	 *
	 * @return array<string, array{0: string}>
	 */
	public static function provide_rejected_urls(): array {
		return array(
			'unrelated host'                           => array( 'https://example.com/activities/123' ),
			'lookalike host (evilstrava.com)'          => array( 'https://evilstrava.com/activities/123' ),
			'lookalike host (strava.com.evil.example)' => array( 'https://strava.com.evil.example/activities/123' ),
			'substring of strava.com in path'          => array( 'https://example.com/redirect?to=strava.com/activities/123' ),
			'short URL form'                           => array( 'https://strava.app.link/nTuKEiCsA2b' ),
			'empty string'                             => array( '' ),
		);
	}

	/**
	 * Tests that non-Strava-canonical URLs return false.
	 *
	 * @dataProvider provide_rejected_urls
	 *
	 * @param string $url Input URL.
	 *
	 * @covers ::block_for_strava_parse_url
	 */
	public function test_rejects_url( string $url ): void {
		$this->assertFalse( block_for_strava_parse_url( $url ) );
	}
}
