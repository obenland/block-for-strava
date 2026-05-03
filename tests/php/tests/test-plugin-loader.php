<?php
/**
 * Tests for the plugin loader (block-for-strava.php).
 *
 * The loader's `init` callback runs during WordPress bootstrap, before
 * PHPUnit starts collecting coverage — invoking it directly here is the
 * only way to credit the registration call and keep the file's coverage
 * gapless.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for `block_for_strava_register_block()`.
 */
class Test_Plugin_Loader extends WP_UnitTestCase {

	/**
	 * Restore block registration after each test.
	 *
	 * The single test in this class deliberately unregisters the block to
	 * defeat `register_block_type_from_metadata`'s already-registered
	 * short-circuit. If a registration step throws or fails the assertion,
	 * the block stays unregistered for the rest of the suite — every later
	 * test that depends on `block-for-strava/embed` being registered would
	 * cascade-fail with a confusing error. Re-register unconditionally here
	 * so test order can't poison sibling tests.
	 */
	public function tear_down(): void {
		$registry = WP_Block_Type_Registry::get_instance();
		if ( ! $registry->is_registered( 'block-for-strava/embed' ) ) {
			block_for_strava_register_block();
		}
		parent::tear_down();
	}

	/**
	 * `block_for_strava_register_block` registers the block from its
	 * build-time `block.json`. Unregister the block first so the
	 * registration that already happened during WP bootstrap doesn't make
	 * this a no-op — calling `register_block_type_from_metadata` for an
	 * already-registered name triggers `doing_it_wrong` and short-circuits
	 * before reaching the registry, leaving the call uncredited.
	 *
	 * @covers ::block_for_strava_register_block
	 */
	public function test_init_registers_block_from_metadata(): void {
		$registry = WP_Block_Type_Registry::get_instance();
		if ( $registry->is_registered( 'block-for-strava/embed' ) ) {
			$registry->unregister( 'block-for-strava/embed' );
		}

		block_for_strava_register_block();

		$this->assertTrue( $registry->is_registered( 'block-for-strava/embed' ) );
	}
}
