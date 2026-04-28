<?php
/**
 * Tests for the block render callback.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for Block_For_Strava::render_block, focused on the data-* attribute
 * serialization that drives Strava's embed.js iframe URL params.
 */
class Test_Render_Block extends WP_UnitTestCase {

	/**
	 * Renders the block via do_blocks() so the block-supports machinery used by
	 * get_block_wrapper_attributes() is set up the same way it is in production.
	 * Calling render_block() directly skips that setup and would crash inside
	 * core's WP_Block_Supports.
	 *
	 * @param  array $overrides Attribute overrides merged onto sensible defaults.
	 * @return string The rendered HTML.
	 */
	private function render( array $overrides = array() ): string {
		$attributes = array_merge(
			array(
				'activityId'         => '42',
				'embedType'          => 'route',
				'caption'            => '',
				'routeShowElevation' => true,
				'routeUnits'         => 'auto',
				'routeFullWidth'     => false,
				'routeMapStyle'      => 'standard',
				'routeTerrain'       => 'auto',
				'routeShowDirt'      => false,
			),
			$overrides
		);
		$comment    = sprintf(
			'<!-- wp:obenland/strava-activity %s /-->',
			wp_json_encode( $attributes )
		);
		return do_blocks( $comment );
	}

	/**
	 * Returns an empty string when no activity id is available.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_returns_empty_string_without_activity_id(): void {
		$this->assertSame(
			'',
			do_blocks( '<!-- wp:obenland/strava-activity /-->' )
		);
	}

	/**
	 * Activity embeds keep the original data-style="standard" and emit no
	 * route-only data attributes, even when route fields are populated.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_activity_embed_ignores_route_options(): void {
		$html = $this->render(
			array(
				'embedType'      => 'activity',
				'routeMapStyle'  => 'satellite',
				'routeFullWidth' => true,
				'routeShowDirt'  => true,
			)
		);
		$this->assertStringContainsString( 'data-embed-type="activity"', $html );
		$this->assertStringContainsString( 'data-style="standard"', $html );
		$this->assertStringNotContainsString( 'data-style="satellite"', $html );
		$this->assertStringNotContainsString( 'data-full-width', $html );
		$this->assertStringNotContainsString( 'data-surface-type', $html );
	}

	/**
	 * Default route options emit only data-style="standard" — nothing else.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_route_defaults_emit_only_map_style(): void {
		$html = $this->render();
		$this->assertStringContainsString( 'data-embed-type="route"', $html );
		$this->assertStringContainsString( 'data-style="standard"', $html );
		$this->assertStringNotContainsString( 'data-hide-elevation', $html );
		$this->assertStringNotContainsString( 'data-units', $html );
		$this->assertStringNotContainsString( 'data-full-width', $html );
		$this->assertStringNotContainsString( 'data-terrain', $html );
		$this->assertStringNotContainsString( 'data-surface-type', $html );
	}

	/**
	 * Disabling the elevation profile adds data-hide-elevation="true".
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_hide_elevation_when_disabled(): void {
		$this->assertStringContainsString(
			'data-hide-elevation="true"',
			$this->render( array( 'routeShowElevation' => false ) )
		);
	}

	/**
	 * Auto units omit the attribute; metric/imperial emit it verbatim.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_units_attribute_only_when_not_auto(): void {
		$this->assertStringNotContainsString(
			'data-units',
			$this->render( array( 'routeUnits' => 'auto' ) )
		);
		$this->assertStringContainsString(
			'data-units="metric"',
			$this->render( array( 'routeUnits' => 'metric' ) )
		);
		$this->assertStringContainsString(
			'data-units="imperial"',
			$this->render( array( 'routeUnits' => 'imperial' ) )
		);
	}

	/**
	 * Responsive width adds data-full-width="true".
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_full_width_when_responsive(): void {
		$this->assertStringContainsString(
			'data-full-width="true"',
			$this->render( array( 'routeFullWidth' => true ) )
		);
	}

	/**
	 * Each map style propagates to data-style.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_map_style_round_trips(): void {
		foreach ( array( 'satellite', 'hybrid', 'dark', 'winter', 'light' ) as $style ) {
			$this->assertStringContainsString(
				sprintf( 'data-style="%s"', $style ),
				$this->render( array( 'routeMapStyle' => $style ) )
			);
		}
	}

	/**
	 * Auto terrain omits the attribute; 2d/3d emit it verbatim.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_terrain_attribute_only_when_not_auto(): void {
		$this->assertStringNotContainsString(
			'data-terrain',
			$this->render( array( 'routeTerrain' => 'auto' ) )
		);
		$this->assertStringContainsString(
			'data-terrain="2d"',
			$this->render( array( 'routeTerrain' => '2d' ) )
		);
		$this->assertStringContainsString(
			'data-terrain="3d"',
			$this->render( array( 'routeTerrain' => '3d' ) )
		);
	}

	/**
	 * Highlighting unpaved surfaces adds data-surface-type="true".
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_surface_type_when_show_dirt(): void {
		$this->assertStringContainsString(
			'data-surface-type="true"',
			$this->render( array( 'routeShowDirt' => true ) )
		);
	}

	/**
	 * Non-boolean values from a hand-edited block comment fall back to the
	 * block.json defaults. `(bool) "false"` is `true` in PHP — strict-type
	 * matching avoids silently flipping the user's intent. Mirrors clampBool
	 * in edit.tsx so editor preview and front-end agree.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_non_boolean_values_fall_back_to_defaults(): void {
		foreach ( array( 'false', 'true', 1, 0, 'maybe', null ) as $value ) {
			$html = $this->render(
				array(
					'routeShowElevation' => $value,
					'routeFullWidth'     => $value,
					'routeShowDirt'      => $value,
				)
			);
			$context = sprintf( 'value=%s', var_export( $value, true ) );
			$this->assertStringNotContainsString(
				'data-hide-elevation',
				$html,
				$context
			);
			$this->assertStringNotContainsString(
				'data-full-width',
				$html,
				$context
			);
			$this->assertStringNotContainsString(
				'data-surface-type',
				$html,
				$context
			);
		}
	}

	/**
	 * Bogus enum values from a hand-edited post fall back to safe defaults.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_invalid_enums_fall_back_to_defaults(): void {
		$html = $this->render(
			array(
				'routeMapStyle' => 'parchment',
				'routeUnits'    => 'furlongs',
				'routeTerrain'  => '4d',
			)
		);
		$this->assertStringContainsString( 'data-style="standard"', $html );
		$this->assertStringNotContainsString( 'data-units', $html );
		$this->assertStringNotContainsString( 'data-terrain', $html );
	}

	/**
	 * Non-default selections combine into a single placeholder div without
	 * stray whitespace artifacts.
	 *
	 * @covers Block_For_Strava::render_block
	 */
	public function test_combined_options_produce_clean_markup(): void {
		$html = $this->render(
			array(
				'routeShowElevation' => false,
				'routeUnits'         => 'metric',
				'routeFullWidth'     => true,
				'routeMapStyle'      => 'satellite',
				'routeTerrain'       => '3d',
				'routeShowDirt'      => true,
			)
		);
		$this->assertStringContainsString( 'data-style="satellite"', $html );
		$this->assertStringContainsString( 'data-hide-elevation="true"', $html );
		$this->assertStringContainsString( 'data-units="metric"', $html );
		$this->assertStringContainsString( 'data-full-width="true"', $html );
		$this->assertStringContainsString( 'data-terrain="3d"', $html );
		$this->assertStringContainsString( 'data-surface-type="true"', $html );
		$this->assertStringNotContainsString( '  data-', $html );
	}
}
