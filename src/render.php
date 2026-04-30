<?php
/**
 * Server-side render callback for the Strava embed block.
 *
 * The block is dynamic: `save` returns null, so the JS bundle persists
 * only the block-comment with attributes and this file rebuilds the
 * front-end markup from those attributes. Strava has no public oEmbed
 * endpoint, so generating the iframe deterministically from the saved
 * URL is the only way to get a stable embed.
 *
 * @package BlockForStrava
 *
 * @var array $attributes Block attributes (`url` plus optional
 *                        `stravaRoute*` overrides).
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

echo Block_For_Strava_Embed::render_block( $attributes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
