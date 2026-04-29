<?php
/**
 * Tests for the Strava oEmbed hijack.
 *
 * Covers the three integration points that make a pasted Strava URL flow
 * through `core/embed` without Strava providing oEmbed: the
 * `pre_oembed_result` short-circuit, the `/oembed/1.0/proxy` REST fallback,
 * and the `wp_embed_register_handler` autoembed callbacks.
 *
 * @package BlockForStrava
 */

declare( strict_types = 1 );

/**
 * Tests for Block_For_Strava_Embed.
 */
class Test_Strava_Embed extends WP_UnitTestCase {

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
		$this->assertMatchesRegularExpression( '/^<iframe\s/', $html );
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
	 * Provides canonical Strava URL/type/id triples for the parametrized
	 * `pre_oembed_result` test.
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
	 * Confirms canonical Strava URLs short-circuit oEmbed with our iframe.
	 *
	 * @dataProvider provide_canonical_urls
	 *
	 * @param string $url         Canonical Strava URL.
	 * @param string $embed_type  Expected singular embed type.
	 * @param string $activity_id Expected numeric ID.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_returns_iframe_for_canonical_url( string $url, string $embed_type, string $activity_id ): void {
		$result = apply_filters( 'pre_oembed_result', null, $url, array() );
		$this->assertIsString( $result );
		$this->assertStravaIframe( $result, $embed_type, $activity_id );
	}

	/**
	 * Non-Strava URLs must fall through so other providers/handlers can run.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_passes_through_non_strava_url(): void {
		$result = apply_filters( 'pre_oembed_result', null, 'https://example.com/foo', array() );
		$this->assertNull( $result );
	}

	/**
	 * The filter contract is "return null to fall through, return string to
	 * short-circuit". A previously-set non-null result must survive — without
	 * this short-circuit our handler would clobber a faster cache hit.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_does_not_clobber_existing_result(): void {
		$existing = '<iframe src="https://example.com/oembed"></iframe>';
		$result   = apply_filters( 'pre_oembed_result', $existing, 'https://www.strava.com/activities/123', array() );
		$this->assertSame( $existing, $result );
	}

	/**
	 * Short URLs follow a remote redirect chain via `wp_safe_remote_head`.
	 * Stub HTTP so the test stays deterministic and offline.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
	 */
	public function test_pre_oembed_result_resolves_short_url(): void {
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

		$result = apply_filters( 'pre_oembed_result', null, 'https://strava.app.link/abcd', array() );

		remove_filter( 'pre_http_request', $callback, 10 );

		$this->assertIsString( $result );
		$this->assertStravaIframe( $result, 'activity', '99999' );
	}

	/**
	 * Embed handler returns a Strava iframe for valid canonical input.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler
	 */
	public function test_embed_handler_builds_iframe_for_canonical_url(): void {
		$html = Block_For_Strava_Embed::embed_handler(
			array( 0 => 'https://www.strava.com/activities/123' )
		);
		$this->assertIsString( $html );
		$this->assertStravaIframe( $html, 'activity', '123' );
	}

	/**
	 * Embed handler must refuse paths that aren't activity/route/segment.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler
	 */
	public function test_embed_handler_rejects_unknown_path(): void {
		$result = Block_For_Strava_Embed::embed_handler(
			array( 0 => 'https://www.strava.com/clubs/1' )
		);
		$this->assertFalse( $result );
	}

	/**
	 * Embed handler must refuse non-numeric ids that embed.js can't render.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler
	 */
	public function test_embed_handler_rejects_non_numeric_id(): void {
		$result = Block_For_Strava_Embed::embed_handler(
			array( 0 => 'https://www.strava.com/activities/abc' )
		);
		$this->assertFalse( $result );
	}

	/**
	 * Embed handler must return false (not bad HTML) when short-URL
	 * resolution fails, so `WP_Embed::shortcode()` falls through to leaving
	 * the URL bare.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler
	 */
	public function test_embed_handler_returns_false_on_short_url_resolve_failure(): void {
		$callback = static function ( $preempt, $args, $url ) {
			if ( str_contains( $url, 'strava.app.link' ) ) {
				return new WP_Error( 'http_failed', 'simulated network error' );
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$result = Block_For_Strava_Embed::embed_handler(
			array( 0 => 'https://strava.app.link/broken' )
		);

		remove_filter( 'pre_http_request', $callback, 10 );

		$this->assertFalse( $result );
	}

	/**
	 * Boundary check: the registered regex must not accept a URL whose ID
	 * segment is followed by extra characters (e.g. /123abc) — without a
	 * trailing delimiter assertion, the `\d+` would greedily match `123`
	 * and we'd embed the wrong activity.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler
	 */
	public function test_autoembed_rejects_id_followed_by_letters(): void {
		global $wp_embed;
		$url    = 'https://www.strava.com/activities/123abc';
		$result = $wp_embed->shortcode( array(), $url );
		// `WP_Embed::shortcode()` returns the original URL when no handler
		// matches, so the absence of an iframe is what we assert.
		$this->assertStringNotContainsString( '<iframe', $result );
	}

	/**
	 * `wp_embed_register_handler` returns autoembed HTML when post content
	 * contains a bare URL. This integration test runs the URL through
	 * `WP_Embed::shortcode()` like autoembed does.
	 *
	 * @covers Block_For_Strava_Embed::embed_handler
	 */
	public function test_autoembed_replaces_bare_canonical_url(): void {
		global $wp_embed;
		$html = $wp_embed->shortcode( array(), 'https://www.strava.com/activities/18233733854' );
		$this->assertIsString( $html );
		$this->assertStravaIframe( $html, 'activity', '18233733854' );
	}

	/**
	 * Confirms the REST proxy fallback rewrites a 404 oEmbed response into
	 * a valid embed payload for Strava URLs. Without this, the editor's
	 * paste-URL flow throws "Sorry, this content could not be embedded."
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_rewrites_strava_response(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		/*
		 * Core's get_proxy_item iterates `$wp_scripts->queue` when an embed
		 * handler matches; lazily-init the global so the test doesn't depend
		 * on an earlier test having enqueued anything.
		 */
		wp_scripts();

		$request = new WP_REST_Request( 'GET', '/oembed/1.0/proxy' );
		$request->set_param( 'url', 'https://www.strava.com/activities/18233733854' );
		$request->set_param( '_wpnonce', wp_create_nonce( 'wp_rest' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertIsObject( $data );
		$this->assertSame( 'rich', $data->type );
		$this->assertSame( 'Strava', $data->provider_name );
		$this->assertStravaIframe( $data->html, 'activity', '18233733854' );
	}

	/**
	 * Other REST endpoints must not see their responses mutated by the filter.
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_ignores_non_proxy_routes(): void {
		$response = new WP_REST_Response( array( 'foo' => 'bar' ) );
		$request  = new WP_REST_Request( 'GET', '/wp/v2/posts' );

		$result = Block_For_Strava_Embed::rest_proxy_fallback( $response, array(), $request );

		$this->assertSame( $response, $result );
	}

	/**
	 * If a previous filter already set valid HTML we must leave it alone.
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_passes_through_when_html_already_present(): void {
		$existing = (object) array( 'html' => '<iframe src="https://example.com"></iframe>' );
		$response = new WP_REST_Response( $existing );
		$request  = new WP_REST_Request( 'GET', '/oembed/1.0/proxy' );
		$request->set_param( 'url', 'https://www.strava.com/activities/123' );

		$result = Block_For_Strava_Embed::rest_proxy_fallback( $response, array(), $request );

		$this->assertSame( $response, $result );
		$this->assertSame( $existing, $result->get_data() );
	}

	/**
	 * Auth/permission errors on Strava URLs must propagate so the editor
	 * can react (re-auth, retry) instead of seeing a synthesized success
	 * payload that hides the real failure.
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_propagates_non_oembed_errors_for_strava_urls(): void {
		$err     = new WP_Error( 'rest_cookie_invalid_nonce', 'nope', array( 'status' => 403 ) );
		$request = new WP_REST_Request( 'GET', '/oembed/1.0/proxy' );
		$request->set_param( 'url', 'https://www.strava.com/activities/18233733854' );

		$result = Block_For_Strava_Embed::rest_proxy_fallback( $err, array(), $request );

		$this->assertSame( $err, $result );
	}

	/**
	 * Builds a baseline core/embed-shaped block content string the way the
	 * production filter receives it: an iframe wrapped in core's figure.
	 *
	 * @param  string $url Bare URL the editor would have stored.
	 */
	private function makeEmbedBlockContent( string $url ): string {
		return sprintf(
			'<figure class="wp-block-embed is-type-rich is-provider-strava wp-block-embed-strava"><div class="wp-block-embed__wrapper">%s%s%s</div></figure>',
			"\n",
			$url,
			"\n"
		);
	}

	/**
	 * Strava URL params land on the iframe `src` when route attrs are set.
	 *
	 * @covers Block_For_Strava_Embed::render_strava_embed
	 */
	public function test_render_strava_embed_appends_route_params(): void {
		$content = $this->makeEmbedBlockContent( 'https://www.strava.com/routes/456' );
		$block   = array(
			'attrs' => array(
				'providerNameSlug'         => 'strava',
				'url'                      => 'https://www.strava.com/routes/456',
				'stravaRouteMapStyle'      => 'satellite',
				'stravaRouteUnits'         => 'metric',
				'stravaRouteFullWidth'     => true,
				'stravaRouteShowDirt'      => true,
				'stravaRouteTerrain'       => '3d',
				'stravaRouteShowElevation' => false,
			),
		);

		$result = Block_For_Strava_Embed::render_strava_embed( $content, $block );

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
	 * Short-URL resolution can fire `wp_safe_remote_head()` (up to 5 hops),
	 * and `render_strava_embed` runs on every front-end render. Without
	 * caching, a single saved short-URL embed would cost five HTTP requests
	 * per page view; this test pins that the second resolution comes from
	 * the transient.
	 *
	 * @covers Block_For_Strava_Embed::maybe_strava_embed
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
		$first  = apply_filters( 'pre_oembed_result', null, $short, array() );
		$second = apply_filters( 'pre_oembed_result', null, $short, array() );

		remove_filter( 'pre_http_request', $callback, 10 );
		delete_transient( 'block_for_strava_resolved_' . md5( $short ) );

		$this->assertIsString( $first );
		$this->assertIsString( $second );
		$this->assertSame( 1, $http_calls, 'Second call should hit the cache instead of HTTP.' );
	}

	/**
	 * Hand-edited block comments can persist non-boolean truthy values
	 * (e.g. the string "false") for boolean attributes; the strict-equals
	 * gate must reject them so the rendered iframe matches what the editor
	 * actually displays.
	 *
	 * @covers Block_For_Strava_Embed::render_strava_embed
	 */
	public function test_render_strava_embed_strict_bool_attrs(): void {
		$content = $this->makeEmbedBlockContent( 'https://www.strava.com/routes/456' );
		$block   = array(
			'attrs' => array(
				'providerNameSlug'     => 'strava',
				'url'                  => 'https://www.strava.com/routes/456',
				// Both of these are truthy under `! empty()` but neither is
				// a real `true` — the URL must come out clean.
				'stravaRouteFullWidth' => 'false',
				'stravaRouteShowDirt'  => 1,
			),
		);

		$result = Block_For_Strava_Embed::render_strava_embed( $content, $block );

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
	 * attribute that carries arbitrary string content. An adversarial value
	 * must never reach the iframe `src` verbatim — the rendered URL stays
	 * clean because the unknown value falls back to the default and the
	 * default-only `style=standard` case is dropped.
	 *
	 * @dataProvider provide_adversarial_route_enums
	 *
	 * @param string $attr_name        Block attribute key under test.
	 * @param string $payload          Adversarial string the attribute could carry.
	 * @param string $forbidden_param  Iframe URL param name that must not appear.
	 *
	 * @covers Block_For_Strava_Embed::render_strava_embed
	 */
	public function test_render_strava_embed_rejects_unknown_enum_values( string $attr_name, string $payload, string $forbidden_param ): void {
		$content = $this->makeEmbedBlockContent( 'https://www.strava.com/routes/456' );
		$block   = array(
			'attrs' => array(
				'providerNameSlug' => 'strava',
				'url'              => 'https://www.strava.com/routes/456',
				$attr_name         => $payload,
			),
		);

		$result = Block_For_Strava_Embed::render_strava_embed( $content, $block );

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
	 * @covers Block_For_Strava_Embed::render_strava_embed
	 */
	public function test_render_strava_embed_clean_url_at_defaults(): void {
		$content = $this->makeEmbedBlockContent( 'https://www.strava.com/routes/456' );
		$block   = array(
			'attrs' => array(
				'providerNameSlug' => 'strava',
				'url'              => 'https://www.strava.com/routes/456',
			),
		);

		$result = Block_For_Strava_Embed::render_strava_embed( $content, $block );

		$this->assertStringContainsString(
			'src="https://strava-embeds.com/route/456"',
			$result
		);
		$this->assertStringNotContainsString( '?style=', $result );
	}

	/**
	 * Activity URLs render the iframe with no route params, matching the
	 * autoembed handler's output exactly.
	 *
	 * @covers Block_For_Strava_Embed::render_strava_embed
	 */
	public function test_render_strava_embed_activity_url(): void {
		$content = $this->makeEmbedBlockContent( 'https://www.strava.com/activities/123' );
		$block   = array(
			'attrs' => array(
				'providerNameSlug'     => 'strava',
				'url'                  => 'https://www.strava.com/activities/123',
				// Route attrs on a non-route URL are ignored.
				'stravaRouteMapStyle'  => 'satellite',
				'stravaRouteFullWidth' => true,
			),
		);

		$result = Block_For_Strava_Embed::render_strava_embed( $content, $block );

		$this->assertStringContainsString(
			'src="https://strava-embeds.com/activity/123"',
			$result
		);
	}

	/**
	 * `stravaRouteFullWidth=true` must drop the `max-width:600px` clamp on the
	 * outer iframe element — without this, the inner Strava embed page goes
	 * responsive while the iframe element itself stays pinned to 600px and
	 * the user-visible width never changes.
	 *
	 * @covers Block_For_Strava_Embed::render_strava_embed
	 */
	public function test_render_strava_embed_full_width_drops_max_width(): void {
		$content = $this->makeEmbedBlockContent( 'https://www.strava.com/routes/456' );
		$block   = array(
			'attrs' => array(
				'providerNameSlug'     => 'strava',
				'url'                  => 'https://www.strava.com/routes/456',
				'stravaRouteFullWidth' => true,
			),
		);

		$result = Block_For_Strava_Embed::render_strava_embed( $content, $block );

		$this->assertStringContainsString( 'fullWidth=true', $result );
		$this->assertStringContainsString( 'style="width:100%;display:block;border:0;"', $result );
		$this->assertStringNotContainsString( 'max-width', $result );
	}

	/**
	 * Routes without `stravaRouteFullWidth` keep the legacy `max-width:600px`
	 * clamp so they don't overflow narrow containers.
	 *
	 * @covers Block_For_Strava_Embed::render_strava_embed
	 */
	public function test_render_strava_embed_default_keeps_max_width(): void {
		$content = $this->makeEmbedBlockContent( 'https://www.strava.com/routes/456' );
		$block   = array(
			'attrs' => array(
				'providerNameSlug' => 'strava',
				'url'              => 'https://www.strava.com/routes/456',
			),
		);

		$result = Block_For_Strava_Embed::render_strava_embed( $content, $block );

		$this->assertStringContainsString( 'style="width:100%;max-width:600px;display:block;border:0;"', $result );
	}

	/**
	 * Non-Strava embeds (e.g. YouTube) must pass through untouched.
	 *
	 * @covers Block_For_Strava_Embed::render_strava_embed
	 */
	public function test_render_strava_embed_skips_non_strava_embeds(): void {
		$content = '<figure class="wp-block-embed is-provider-youtube"><div class="wp-block-embed__wrapper"><iframe src="https://www.youtube.com/embed/abc"></iframe></div></figure>';
		$block   = array(
			'attrs' => array(
				'providerNameSlug' => 'youtube',
				'url'              => 'https://www.youtube.com/watch?v=abc',
			),
		);

		$result = Block_For_Strava_Embed::render_strava_embed( $content, $block );

		$this->assertSame( $content, $result );
	}

	/**
	 * Errors for non-Strava URLs must propagate untouched.
	 *
	 * @covers Block_For_Strava_Embed::rest_proxy_fallback
	 */
	public function test_rest_proxy_fallback_passes_through_non_strava_error(): void {
		$err     = new WP_Error( 'oembed_invalid_url', 'nope', array( 'status' => 404 ) );
		$request = new WP_REST_Request( 'GET', '/oembed/1.0/proxy' );
		$request->set_param( 'url', 'https://example.com/post/1' );

		$result = Block_For_Strava_Embed::rest_proxy_fallback( $err, array(), $request );

		$this->assertSame( $err, $result );
	}
}
