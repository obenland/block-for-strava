<?php
/**
 * Server-side render callback for the Strava embed block.
 *
 * Strava does not publish an oEmbed endpoint, so we generate the iframe
 * markup deterministically from the saved URL and route attributes. The
 * actual rendering lives in `Block_For_Strava_Embed::render_block`; this
 * file is the entry point referenced from `block.json`'s `render` field.
 *
 * @package BlockForStrava
 *
 * @var array $attributes Block attributes.
 * @var string $content   Save-component output (figure/wrapper/url).
 */

declare( strict_types = 1 );

defined( 'ABSPATH' ) || exit;

echo Block_For_Strava_Embed::render_block( $attributes, $content ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
