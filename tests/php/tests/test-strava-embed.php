<?php
/**
 * Tests for the server-side render callback of the Strava embed block.
 *
 * The render callback is the only PHP that runs at request time for the
 * block (registered in `block.json`), so these tests pin its behavior
 * across canonical URLs, route attribute clamping, short-URL resolution,
 * and the iframe shape PR #22 settled on.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for Block_For_Strava_Embed::render_block.
 */
class Test_Strava_Embed extends WP_UnitTestCase {

	/**
	 * Pins that `register_block_type_from_metadata` actually fired during
	 * `init`. The Block Directory listing depends on the block being
	 * registered under the canonical name; if `block-for-strava.php`'s
	 * init action ever silently breaks (path drift, missing build/, action
	 * priority change), the rest of the suite still passes while the
	 * production block disappears from the inserter.
	 */
	public function test_block_is_registered(): void {
		$registry = WP_Block_Type_Registry::get_instance();
		$this->assertTrue(
			$registry->is_registered( 'block-for-strava/embed' ),
			'block-for-strava/embed must be registered after init.'
		);
		$type = $registry->get_registered( 'block-for-strava/embed' );
		$this->assertIsCallable(
			$type->render_callback,
			'Block must have a callable render_callback wired through block.json.'
		);
		$this->assertSame( 'embed', $type->category );
	}

	/**
	 * `align: 'wide'` declared in block.json must reach the rendered figure
	 * — `render_block` runs through `get_block_wrapper_attributes()` so that
	 * core's block-supports machinery gets a chance to add `alignwide` and
	 * any custom className before the figure goes out. Replacing the figure
	 * wholesale (without the wrapper helper) silently strips alignment, and
	 * Block Directory reviewers explicitly check that align supports work.
	 */
	public function test_render_through_do_blocks_preserves_align(): void {
		$block_markup = '<!-- wp:block-for-strava/embed {"url":"https://www.strava.com/activities/123","align":"wide"} --><figure class="wp-block-embed alignwide is-type-rich is-provider-strava wp-block-embed-strava"><div class="wp-block-embed__wrapper">' . "\n" . 'https://www.strava.com/activities/123' . "\n" . '</div></figure><!-- /wp:block-for-strava/embed -->';

		$rendered = do_blocks( $block_markup );

		$this->assertStringContainsString( 'alignwide', $rendered );
		$this->assertStringContainsString( '<iframe', $rendered );
	}

	/**
	 * Asserts the iframe HTML loads the expected Strava embed page directly.
	 *
	 * The earlier shape wrapped a placeholder div + embed.js inside a data:
	 * URL, but that imposed a null origin on the nested strava-embeds.com
	 * iframe and broke route map CORS. Today the iframe `src` points at the
	 * real share URL so the embed page runs on its actual origin.
	 *
	 * @param  string $html        The iframe HTML to inspect.
	 * @param  string $embed_type  Expected URL path segment ('activity' etc.).
	 * @param  string $activity_id Expected URL ID segment.
	 */
	private function assertStravaIframe( string $html, string $embed_type, string $activity_id ): void {
		$this->assertStringContainsString( '<iframe', $html );
		$this->assertStringContainsString( 'class="strava-embed-iframe"', $html );
		$this->assertStringContainsString(
			sprintf( 'src="https://strava-embeds.com/%s/%s"', $embed_type, $activity_id ),
			$html
		);

		/*
		 * Sandbox + referrer policy are the defense-in-depth line — assert
		 * them so a future tweak can't quietly drop framebust protection or
		 * start leaking the host page URL via Referer.
		 */
		$this->assertStringContainsString(
			'sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"',
			$html
		);
		$this->assertStringContainsString( 'referrerpolicy="origin"', $html );
		// The plugin no longer ships a frontend stylesheet, so an inline
		// max-width cap is what stops `width="600"` from overflowing
		// narrow containers (mobile, widget areas).
		$this->assertStringContainsString( 'style="width:100%;max-width:600px;display:block;border:0;"', $html );
	}

	/**
	 * Renders a `block-for-strava/embed` block with the given attributes
	 * through the full `do_blocks` pipeline.
	 *
	 * Routing through `do_blocks` matters because the render callback
	 * calls `get_block_wrapper_attributes()`, which reads from a global
	 * set by `WP_Block::render` — calling the static method directly
	 * crashes on a null `block_to_render`.
	 *
	 * @param  array $attributes Block attributes (must include `url`).
	 * @return string            Front-end HTML for the rendered block.
	 */
	private function renderBlock( array $attributes ): string {
		$url    = isset( $attributes['url'] ) ? (string) $attributes['url'] : '';
		$markup = sprintf(
			'<!-- wp:block-for-strava/embed %s --><figure class="wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava"><div class="wp-block-embed__wrapper">%s%s%s</div></figure><!-- /wp:block-for-strava/embed -->',
			wp_json_encode( $attributes ),
			"\n",
			$url,
			"\n"
		);
		return do_blocks( $markup );
	}

	/**
	 * Provides canonical Strava URL/type/id triples for the parametrized test.
	 *
	 * @return array<string, array{0: string, 1: string, 2: string}>
	 */
	public static function provide_canonical_urls(): array {
		return array(
			'activity' => array( 'https://www.strava.com/activities/18233733854', 'activity', '18233733854' ),
			'route'    => array( 'https://www.strava.com/routes/3379104463896442748', 'route', '3379104463896442748' ),
			'segment'  => array( 'https://www.strava.com/segments/789', 'segment', '789' ),
		);
	}

	/**
	 * Confirms canonical Strava URLs render to a sandboxed iframe pointing
	 * directly at the right strava-embeds.com path.
	 *
	 * @dataProvider provide_canonical_urls
	 *
	 * @param string $url         Canonical Strava URL.
	 * @param string $embed_type  Expected singular embed type.
	 * @param string $activity_id Expected numeric ID.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_returns_iframe_for_canonical_url( string $url, string $embed_type, string $activity_id ): void {
		$result = $this->renderBlock( array( 'url' => $url ) );
		$this->assertStravaIframe( $result, $embed_type, $activity_id );
	}

	/**
	 * Boundary check: a URL whose ID segment is followed by extra
	 * characters (e.g. /123abc) must not match — without a trailing
	 * delimiter assertion, the `\d+` would greedily match `123` and we'd
	 * embed the wrong activity. The render callback returns the original
	 * save content unchanged so the URL stays visible (rather than
	 * silently disappearing) on the front end.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_returns_content_unchanged_for_id_with_suffix(): void {
		$url    = 'https://www.strava.com/activities/123abc';
		$result = $this->renderBlock( array( 'url' => $url ) );
		// Saved URL passes through to the rendered output; no iframe is
		// emitted because the URL didn't resolve.
		$this->assertStringContainsString( $url, $result );
		$this->assertStringNotContainsString( '<iframe', $result );
	}

	/**
	 * Non-Strava URLs (e.g. a typo, a stale paste) leave the saved URL
	 * visible in the rendered output. We don't try to embed unknown
	 * providers, but we also don't drop the block.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_returns_content_unchanged_for_non_strava_url(): void {
		$url    = 'https://example.com/foo';
		$result = $this->renderBlock( array( 'url' => $url ) );
		$this->assertStringContainsString( $url, $result );
		$this->assertStringNotContainsString( '<iframe', $result );
	}

	/**
	 * Empty `url` attribute leaves the saved markup alone. (This shouldn't
	 * happen in practice — the editor doesn't let you save without a URL —
	 * but a hand-edited block comment could.)
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_returns_content_unchanged_for_empty_url(): void {
		$result = $this->renderBlock( array() );
		$this->assertStringNotContainsString( '<iframe', $result );
	}

	/**
	 * Short URLs follow a remote redirect chain via `wp_safe_remote_head`.
	 * Stub HTTP so the test stays deterministic and offline.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_resolves_short_url(): void {
		$callback = static function ( $preempt, $args, $url ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				return array(
					'response' => array(
						'code'    => 302,
						'message' => 'Found',
					),
					'headers'  => array( 'location' => 'https://www.strava.com/activities/99999' ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$short  = 'https://strava.app.link/abcd';
		$result = $this->renderBlock( array( 'url' => $short ) );

		remove_filter( 'pre_http_request', $callback, 10 );

		$this->assertStravaIframe( $result, 'activity', '99999' );
	}

	/**
	 * Short-URL resolution can fire `wp_safe_remote_head()` (up to 5 hops),
	 * and `render_block` runs on every front-end render. Without caching,
	 * a single saved short-URL embed would cost five HTTP requests per
	 * page view; this test pins that the second resolution comes from the
	 * transient.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_short_url_resolution_is_cached(): void {
		$http_calls = 0;
		$callback   = static function ( $preempt, $args, $url ) use ( &$http_calls ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				++$http_calls;
				return array(
					'response' => array(
						'code'    => 302,
						'message' => 'Found',
					),
					'headers'  => array( 'location' => 'https://www.strava.com/activities/77777' ),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$short  = 'https://strava.app.link/cached-' . wp_generate_uuid4();
		$first  = $this->renderBlock( array( 'url' => $short ) );
		$second = $this->renderBlock( array( 'url' => $short ) );

		remove_filter( 'pre_http_request', $callback, 10 );
		delete_transient( 'block_for_strava_resolved_' . md5( $short ) );

		$this->assertStringContainsString( '<iframe', $first );
		$this->assertStringContainsString( '<iframe', $second );
		$this->assertSame( 1, $http_calls, 'Second call should hit the cache instead of HTTP.' );
	}

	/**
	 * Strava URL params land on the iframe `src` when route attrs are set.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_appends_route_params(): void {
		$attrs = array(
			'url'                      => 'https://www.strava.com/routes/456',
			'stravaRouteMapStyle'      => 'satellite',
			'stravaRouteUnits'         => 'metric',
			'stravaRouteFullWidth'     => true,
			'stravaRouteShowDirt'      => true,
			'stravaRouteTerrain'       => '3d',
			'stravaRouteShowElevation' => false,
		);

		$result = $this->renderBlock( $attrs );

		$this->assertStringContainsString( 'class="wp-block-embed__wrapper"', $result );
		$this->assertSame( 1, preg_match( '~<iframe[^>]+src="([^"]+)"~', $result, $matches ) );
		$decoded_src = html_entity_decode( $matches[1], ENT_QUOTES );
		$parts       = wp_parse_url( $decoded_src );
		$this->assertSame( '/route/456', $parts['path'] );
		parse_str( $parts['query'] ?? '', $query );
		$this->assertSame(
			array(
				'style'         => 'satellite',
				'hideElevation' => 'true',
				'units'         => 'metric',
				'fullWidth'     => 'true',
				'terrain'       => '3d',
				'surfaceType'   => 'true',
			),
			$query
		);
	}

	/**
	 * Hand-edited block comments can persist non-boolean truthy values
	 * (e.g. the string "false") for boolean attributes; the strict-equals
	 * gate must reject them so the rendered iframe matches what the editor
	 * actually displays.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_strict_bool_attrs(): void {
		$attrs = array(
			'url'                  => 'https://www.strava.com/routes/456',
			// Both of these are truthy under `! empty()` but neither is
			// a real `true` — the URL must come out clean.
			'stravaRouteFullWidth' => 'false',
			'stravaRouteShowDirt'  => 1,
		);

		$result = $this->renderBlock( $attrs );

		$this->assertStringContainsString(
			'src="https://strava-embeds.com/route/456"',
			$result
		);
		$this->assertStringNotContainsString( 'fullWidth=', $result );
		$this->assertStringNotContainsString( 'surfaceType=', $result );
	}

	/**
	 * Provides adversarial values for each enum-validated route attribute,
	 * paired with the iframe URL param key that must NOT appear in output.
	 *
	 * @return array<string, array{0: string, 1: string, 2: string}>
	 */
	public static function provide_adversarial_route_enums(): array {
		return array(
			'mapStyle injection' => array( 'stravaRouteMapStyle', '"><script>alert(1)</script>', 'style' ),
			'units injection'    => array( 'stravaRouteUnits', '" onload="alert(1)', 'units' ),
			'terrain injection'  => array( 'stravaRouteTerrain', 'javascript:alert(1)', 'terrain' ),
		);
	}

	/**
	 * Pins the `in_array(..., true)` allowlist guards in
	 * `route_params_from_attrs()` as the security boundary for any route
	 * attribute that carries arbitrary string content. An adversarial
	 * value must never reach the iframe `src` verbatim — the rendered URL
	 * stays clean because the unknown value falls back to the default
	 * and the default-only `style=standard` case is dropped.
	 *
	 * @dataProvider provide_adversarial_route_enums
	 *
	 * @param string $attr_name        Block attribute key under test.
	 * @param string $payload          Adversarial string the attribute could carry.
	 * @param string $forbidden_param  Iframe URL param name that must not appear.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_rejects_unknown_enum_values( string $attr_name, string $payload, string $forbidden_param ): void {
		$attrs = array(
			'url'      => 'https://www.strava.com/routes/456',
			$attr_name => $payload,
		);

		$result = $this->renderBlock( $attrs );

		// Adversarial value never reaches the rendered HTML.
		$this->assertStringNotContainsString( $payload, $result );

		// Extract the iframe src and inspect its query string, so the
		// assertion targets URL params rather than e.g. the inline `style`
		// attribute that the iframe always carries.
		$this->assertSame( 1, preg_match( '~<iframe[^>]+src="([^"]+)"~', $result, $matches ) );
		$decoded_src = html_entity_decode( $matches[1], ENT_QUOTES );
		$parts       = wp_parse_url( $decoded_src );
		$this->assertSame( '/route/456', $parts['path'] );
		parse_str( $parts['query'] ?? '', $query );
		$this->assertArrayNotHasKey( $forbidden_param, $query );
	}

	/**
	 * Routes at defaults render a clean URL (no params) — keeps caches and
	 * the iframe URL stable when nothing has been customized.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_clean_url_at_defaults(): void {
		$result = $this->renderBlock(
			array( 'url' => 'https://www.strava.com/routes/456' )
		);

		$this->assertStringContainsString(
			'src="https://strava-embeds.com/route/456"',
			$result
		);
		$this->assertStringNotContainsString( '?style=', $result );
	}

	/**
	 * Activity URLs render the iframe with no route params (the route
	 * options on a non-route URL are silently ignored).
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_activity_url(): void {
		$attrs = array(
			'url'                  => 'https://www.strava.com/activities/123',
			// Route attrs on a non-route URL are ignored.
			'stravaRouteMapStyle'  => 'satellite',
			'stravaRouteFullWidth' => true,
		);

		$result = $this->renderBlock( $attrs );

		$this->assertStringContainsString(
			'src="https://strava-embeds.com/activity/123"',
			$result
		);
	}

	/**
	 * `stravaRouteFullWidth=true` must drop the `max-width:600px` clamp on
	 * the outer iframe element — without this, the inner Strava embed page
	 * goes responsive while the iframe element itself stays pinned to
	 * 600px and the user-visible width never changes.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_full_width_drops_max_width(): void {
		$attrs = array(
			'url'                  => 'https://www.strava.com/routes/456',
			'stravaRouteFullWidth' => true,
		);

		$result = $this->renderBlock( $attrs );

		$this->assertStringContainsString( 'fullWidth=true', $result );
		$this->assertStringContainsString( 'style="width:100%;display:block;border:0;"', $result );
		$this->assertStringNotContainsString( 'max-width', $result );
	}

	/**
	 * Routes without `stravaRouteFullWidth` keep the legacy `max-width:600px`
	 * clamp so they don't overflow narrow containers.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_default_keeps_max_width(): void {
		$result = $this->renderBlock(
			array( 'url' => 'https://www.strava.com/routes/456' )
		);

		$this->assertStringContainsString( 'style="width:100%;max-width:600px;display:block;border:0;"', $result );
	}
}
