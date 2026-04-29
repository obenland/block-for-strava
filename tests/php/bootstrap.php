<?php
/**
 * PHPUnit bootstrap for Block for Strava tests.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

$_tests_dir = getenv( 'WP_TESTS_DIR' );

if ( ! $_tests_dir ) {
	$_tests_dir = rtrim( sys_get_temp_dir(), '/\\' ) . '/wordpress-tests-lib';
}

if ( ! file_exists( "$_tests_dir/includes/functions.php" ) ) {
	echo "Could not find $_tests_dir/includes/functions.php\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	exit( 1 );
}

require_once "$_tests_dir/includes/functions.php";

/**
 * Manually loads the plugin under test.
 */
function _manually_load_plugin(): void {
	require_once dirname( __DIR__, 2 ) . '/block-for-strava.php';
}
tests_add_filter( 'muplugins_loaded', '_manually_load_plugin' );

require_once "$_tests_dir/includes/bootstrap.php";
