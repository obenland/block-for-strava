<?php
/**
 * Tests for Block_For_Strava_Embed::is_allowed_strava_url().
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for Block_For_Strava_Embed::is_allowed_strava_url().
 */
class Test_Is_Allowed_Strava_Url extends WP_UnitTestCase {

	/**
	 * Allowlist used by the resolver for redirect targets.
	 *
	 * @var string[]
	 */
	private const ALLOWED = array( 'strava.app.link', 'strava.com' );

	/**
	 * Provides URLs that must be accepted by the allowlist.
	 *
	 * @return array<string, array{0: string}>
	 */
	public static function provide_allowed_urls(): array {
		return array(
			'exact strava.app.link'    => array( 'https://strava.app.link/abc' ),
			'subdomain of strava.app.link' => array( 'https://foo.strava.app.link/abc' ),
			'www.strava.com canonical' => array( 'https://www.strava.com/activities/1' ),
			'bare strava.com host'     => array( 'https://strava.com/activities/1' ),
			'http strava.com'          => array( 'http://strava.com/' ),
			'upper-case scheme + host' => array( 'HTTPS://STRAVA.COM/' ),
		);
	}

	/**
	 * Tests that allowed hosts (exact match and proper subdomains) pass.
	 *
	 * @dataProvider provide_allowed_urls
	 *
	 * @param string $url Input URL.
	 *
	 * @covers Block_For_Strava_Embed::is_allowed_strava_url
	 */
	public function test_allows_url( string $url ): void {
		$this->assertTrue( Block_For_Strava_Embed::is_allowed_strava_url( $url, self::ALLOWED ) );
	}

	/**
	 * Provides URLs that must be rejected by the allowlist.
	 *
	 * @return array<string, array{0: string}>
	 */
	public static function provide_rejected_urls(): array {
		return array(
			'suffix-bypass evilstrava.app.link'        => array( 'https://evilstrava.app.link/x' ),
			'suffix-bypass xstrava.com'                => array( 'https://xstrava.com/x' ),
			'host with allowlist as middle label'      => array( 'https://strava.app.link.attacker.com/x' ),
			'javascript: scheme'                       => array( 'javascript:alert(1)' ),
			'ftp scheme'                               => array( 'ftp://strava.com/' ),
			'file scheme'                              => array( 'file:///etc/passwd' ),
			'empty string'                             => array( '' ),
			'relative path (no host)'                  => array( '/relative/path' ),
			'malformed (not a URL)'                    => array( 'not a url' ),
		);
	}

	/**
	 * Tests that disallowed URLs (suffix bypass, non-http(s) scheme,
	 * malformed/empty) are rejected.
	 *
	 * @dataProvider provide_rejected_urls
	 *
	 * @param string $url Input URL.
	 *
	 * @covers Block_For_Strava_Embed::is_allowed_strava_url
	 */
	public function test_rejects_url( string $url ): void {
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( $url, self::ALLOWED ) );
	}

	/**
	 * Tests that the allowlist is honored: a URL on a host not in the allowlist is rejected
	 * even though it would pass with a broader allowlist.
	 *
	 * @covers Block_For_Strava_Embed::is_allowed_strava_url
	 */
	public function test_honors_allowlist(): void {
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( 'https://www.strava.com/activities/1', array( 'strava.app.link' ) ) );
		$this->assertTrue( Block_For_Strava_Embed::is_allowed_strava_url( 'https://www.strava.com/activities/1', array( 'strava.com' ) ) );
	}
}
