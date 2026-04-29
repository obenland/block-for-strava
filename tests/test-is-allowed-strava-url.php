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
	 * Tests that allowed hosts (exact match and proper subdomains) pass.
	 *
	 * @covers Block_For_Strava_Embed::is_allowed_strava_url
	 */
	public function test_allows_strava_hosts(): void {
		$this->assertTrue( Block_For_Strava_Embed::is_allowed_strava_url( 'https://strava.app.link/abc', self::ALLOWED ) );
		$this->assertTrue( Block_For_Strava_Embed::is_allowed_strava_url( 'https://foo.strava.app.link/abc', self::ALLOWED ) );
		$this->assertTrue( Block_For_Strava_Embed::is_allowed_strava_url( 'https://www.strava.com/activities/1', self::ALLOWED ) );
		$this->assertTrue( Block_For_Strava_Embed::is_allowed_strava_url( 'https://strava.com/activities/1', self::ALLOWED ) );
		$this->assertTrue( Block_For_Strava_Embed::is_allowed_strava_url( 'http://strava.com/', self::ALLOWED ) );
		$this->assertTrue( Block_For_Strava_Embed::is_allowed_strava_url( 'HTTPS://STRAVA.COM/', self::ALLOWED ) );
	}

	/**
	 * Tests that suffix-bypass hosts are rejected.
	 *
	 * @covers Block_For_Strava_Embed::is_allowed_strava_url
	 */
	public function test_rejects_suffix_bypass(): void {
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( 'https://evilstrava.app.link/x', self::ALLOWED ) );
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( 'https://xstrava.com/x', self::ALLOWED ) );
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( 'https://strava.app.link.attacker.com/x', self::ALLOWED ) );
	}

	/**
	 * Tests that non-http(s) schemes are rejected.
	 *
	 * @covers Block_For_Strava_Embed::is_allowed_strava_url
	 */
	public function test_rejects_non_http_schemes(): void {
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( 'javascript:alert(1)', self::ALLOWED ) );
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( 'ftp://strava.com/', self::ALLOWED ) );
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( 'file:///etc/passwd', self::ALLOWED ) );
	}

	/**
	 * Tests that malformed or empty URLs are rejected.
	 *
	 * @covers Block_For_Strava_Embed::is_allowed_strava_url
	 */
	public function test_rejects_malformed_urls(): void {
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( '', self::ALLOWED ) );
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( '/relative/path', self::ALLOWED ) );
		$this->assertFalse( Block_For_Strava_Embed::is_allowed_strava_url( 'not a url', self::ALLOWED ) );
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
