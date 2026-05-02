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
		$rendered = $this->renderBlock(
			array(
				'url'   => 'https://www.strava.com/activities/123',
				'align' => 'wide',
			)
		);

		$this->assertStringContainsString( 'alignwide', $rendered );
		$this->assertStringContainsString( '<iframe', $rendered );
	}

	/**
	 * `anchor` declared in `block.json` supports must reach the rendered
	 * figure as an `id` attribute. Without it, in-page jump links to the
	 * embed (`#my-ride`) silently break for any post that imported a
	 * `core/embed` with an anchor and was auto-converted by the plugin.
	 * Covers the same render seam as the align test, but for anchor —
	 * `get_block_wrapper_attributes()` is the shared mechanism so a
	 * regression in either path would surface here first.
	 */
	public function test_render_through_do_blocks_preserves_anchor(): void {
		$rendered = $this->renderBlock(
			array(
				'url'    => 'https://www.strava.com/activities/123',
				'anchor' => 'my-ride',
			)
		);

		$this->assertStringContainsString( 'id="my-ride"', $rendered );
		$this->assertStringContainsString( '<iframe', $rendered );
	}

	/**
	 * Caption text saved on the block must reach the rendered figure as
	 * a `<figcaption>` inside the wrapper. Empty / whitespace-only
	 * captions emit no figcaption (so a stray empty element doesn't
	 * inflate the figure), and basic inline formatting (`<a>`, `<em>`,
	 * `<strong>`) survives `wp_kses_post` while scripts are stripped.
	 */
	public function test_render_emits_figcaption_when_caption_set(): void {
		$rendered = $this->renderBlock(
			array(
				'url'     => 'https://www.strava.com/activities/123',
				'caption' => 'My morning ride',
			)
		);

		$this->assertStringContainsString( '<figcaption', $rendered );
		$this->assertStringContainsString( 'My morning ride', $rendered );
	}

	/**
	 * Caption sanitization: `wp_kses_post` permits inline formatting
	 * (`<a>`, `<em>`, `<strong>`, `<br>`) but strips `<script>` and
	 * other dangerous markup. The script tag itself must not survive
	 * — the inner text is allowed to remain as inert text content
	 * (that's how `wp_kses_post` works) but with the tag removed it
	 * cannot execute.
	 */
	public function test_render_sanitizes_caption_html(): void {
		$rendered = $this->renderBlock(
			array(
				'url'     => 'https://www.strava.com/activities/123',
				'caption' => 'See <a href="https://example.com">my ride</a>!<script>alert(1)</script>',
			)
		);

		$this->assertStringContainsString( '<a href="https://example.com">my ride</a>', $rendered );
		$this->assertStringNotContainsString( '<script', $rendered );
		$this->assertStringNotContainsString( '</script>', $rendered );
	}

	/**
	 * An empty or whitespace-only caption attribute must produce no
	 * `<figcaption>` element at all. Otherwise the figure would gain a
	 * stray empty caption that styles can stretch open, leaving visible
	 * whitespace under embeds that don't have a caption set.
	 */
	public function test_render_omits_figcaption_for_empty_caption(): void {
		$rendered = $this->renderBlock(
			array(
				'url'     => 'https://www.strava.com/activities/123',
				'caption' => '   ',
			)
		);

		$this->assertStringNotContainsString( '<figcaption', $rendered );
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
	 * outside that context returns just the supplied class string with no
	 * support for `align`, `className`, or `anchor`. The block is dynamic
	 * (save returns null), so the comment carries only attributes.
	 *
	 * @param  array $attributes Block attributes (must include `url`).
	 * @return string            Front-end HTML for the rendered block.
	 */
	private function renderBlock( array $attributes ): string {
		/*
		 * Cast to object so empty attributes JSON-encode as `{}` rather
		 * than `[]` — that's the shape Gutenberg's serializer emits for
		 * an empty-attribute block, and `do_blocks` returns the comment
		 * unchanged when the attrs payload is a JSON array instead.
		 */
		$markup = sprintf(
			'<!-- wp:block-for-strava/embed %s /-->',
			wp_json_encode( (object) $attributes )
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
	 * embed the wrong activity.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_emits_nothing_for_id_with_suffix(): void {
		$url    = 'https://www.strava.com/activities/123abc';
		$result = $this->renderBlock( array( 'url' => $url ) );
		// The Edit component already warned the author; on the front end
		// we render nothing rather than leak a bare URL the user thought
		// would be embedded.
		$this->assertSame( '', trim( $result ) );
	}

	/**
	 * Non-Strava URLs (e.g. a typo, a stale paste) emit nothing. We don't
	 * try to embed unknown providers, and the URL is preserved in the
	 * block-comment JSON so the author can recover by re-editing.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_emits_nothing_for_non_strava_url(): void {
		$url    = 'https://example.com/foo';
		$result = $this->renderBlock( array( 'url' => $url ) );
		$this->assertSame( '', trim( $result ) );
	}

	/**
	 * Empty `url` attribute emits nothing. (Shouldn't happen in practice
	 * — the editor's placeholder requires a URL — but a hand-edited block
	 * comment could remove it.)
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_emits_nothing_for_empty_url(): void {
		$result = $this->renderBlock( array() );
		$this->assertSame( '', trim( $result ) );
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

	/**
	 * Activities whose visibility isn't "Everyone" need a `?token=…` on the
	 * iframe URL or strava-embeds.com 403s. The token reaches the block via
	 * the snippet-paste flow, and the renderer must thread it through.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_appends_token_for_activity(): void {
		$result = $this->renderBlock(
			array(
				'url'              => 'https://www.strava.com/activities/18233733854',
				'stravaEmbedToken' => 'gS4P2FvtBZlKXOaVgke3eG1ExyfzKWW18kKuXmYX-Vc',
			)
		);

		$this->assertSame( 1, preg_match( '~<iframe[^>]+src="([^"]+)"~', $result, $matches ) );
		$decoded_src = html_entity_decode( $matches[1], ENT_QUOTES );
		$parts       = wp_parse_url( $decoded_src );
		$this->assertSame( '/activity/18233733854', $parts['path'] );
		parse_str( $parts['query'] ?? '', $query );
		$this->assertSame( 'gS4P2FvtBZlKXOaVgke3eG1ExyfzKWW18kKuXmYX-Vc', $query['token'] ?? null );
	}

	/**
	 * The token must coexist with route params on the same iframe URL.
	 * Strava's share dialog can ship a `data-token` for routes too, and
	 * the snippet-paste path round-trips it; this test pins that the
	 * renderer doesn't drop one in favor of the other.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_token_coexists_with_route_params(): void {
		$result = $this->renderBlock(
			array(
				'url'                 => 'https://www.strava.com/routes/456',
				'stravaEmbedToken'    => 'rOuTeToken',
				'stravaRouteMapStyle' => 'satellite',
			)
		);

		$this->assertSame( 1, preg_match( '~<iframe[^>]+src="([^"]+)"~', $result, $matches ) );
		$decoded_src = html_entity_decode( $matches[1], ENT_QUOTES );
		parse_str( wp_parse_url( $decoded_src, PHP_URL_QUERY ) ?? '', $query );
		$this->assertSame( 'satellite', $query['style'] ?? null );
		$this->assertSame( 'rOuTeToken', $query['token'] ?? null );
	}

	/**
	 * An empty token must not produce `?token=` on the iframe URL — that
	 * would render `https://strava-embeds.com/activity/123?token=` which
	 * Strava's embed page handles inconsistently. Stay with the clean URL
	 * shape when no token has been resolved.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_skips_empty_token(): void {
		$result = $this->renderBlock(
			array(
				'url'              => 'https://www.strava.com/activities/123',
				'stravaEmbedToken' => '',
			)
		);

		$this->assertStringContainsString(
			'src="https://strava-embeds.com/activity/123"',
			$result
		);
		$this->assertStringNotContainsString( 'token=', $result );
	}

	/**
	 * Without a stored token, an activity URL must render the clean iframe
	 * shape (no `?token=`). For tokenized activities the iframe will 403
	 * client-side — the editor's preflight surfaces that as a notice. For
	 * public-Everyone activities, this is exactly what works.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_url_only_when_no_token_attribute(): void {
		$result = $this->renderBlock(
			array( 'url' => 'https://www.strava.com/activities/12345' )
		);

		$this->assertStringContainsString(
			'src="https://strava-embeds.com/activity/12345"',
			$result
		);
		$this->assertStringNotContainsString( 'token=', $result );
	}

	/**
	 * The render path must NOT make outbound HTTP calls for activity URLs
	 * — token discovery isn't possible without auth, and a per-render
	 * scrape would burn a network round-trip per page view to learn
	 * nothing useful.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_makes_no_http_calls_for_activities(): void {
		$http_calls = 0;
		$callback   = static function ( $preempt, $args, $url ) use ( &$http_calls ) {
			if ( str_contains( $url, 'strava.com' ) || str_contains( $url, 'strava-embeds.com' ) ) {
				++$http_calls;
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$this->renderBlock(
			array( 'url' => 'https://www.strava.com/activities/123' )
		);

		remove_filter( 'pre_http_request', $callback, 10 );

		$this->assertSame( 0, $http_calls, 'Render must not trigger any outbound HTTP for activity URLs.' );
	}

	/**
	 * Hand-edited block markup can persist a non-string `stravaEmbedToken`
	 * value (e.g. an array). The strict `is_string` guard in `render_block`
	 * must reject it so the iframe URL doesn't get a literal `token=Array`
	 * appended.
	 *
	 * @covers Block_For_Strava_Embed::render_block
	 */
	public function test_render_block_rejects_non_string_token(): void {
		$result = $this->renderBlock(
			array(
				'url'              => 'https://www.strava.com/activities/123',
				'stravaEmbedToken' => array( 'not', 'a', 'string' ),
			)
		);

		$this->assertStringContainsString(
			'src="https://strava-embeds.com/activity/123"',
			$result
		);
		$this->assertStringNotContainsString( 'token=', $result );
	}

	/**
	 * Editor's URL-paste flow calls `/embed-status` to learn whether the
	 * activity URL alone produces a working iframe. Strava 200 → embeddable.
	 * Strava 403 → not embeddable; editor surfaces a notice instructing the
	 * user to paste the share-dialog snippet instead. Stub HTTP so the test
	 * stays deterministic and offline.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_reports_embeddable_for_public_activity(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$activity_id = '44444444444';
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $activity_id ) );

		$callback = static function ( $preempt, $args, $url ) use ( $activity_id ) {
			if ( str_contains( $url, 'strava-embeds.com/activity/' . $activity_id ) ) {
				return array(
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'headers'  => array(),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$request->set_param( 'type', 'activity' );
		$request->set_param( 'id', $activity_id );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'pre_http_request', $callback, 10 );
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $activity_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'embeddable' => true,
				'status'     => 200,
			),
			$response->get_data()
		);
	}

	/**
	 * 403 from strava-embeds.com is the "needs token" signal — the
	 * endpoint must report `embeddable: false` so the editor can show its
	 * notice.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_reports_not_embeddable_on_403(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$activity_id = '55555555555';
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $activity_id ) );

		$callback = static function ( $preempt, $args, $url ) use ( $activity_id ) {
			if ( str_contains( $url, 'strava-embeds.com/activity/' . $activity_id ) ) {
				return array(
					'response' => array(
						'code'    => 403,
						'message' => 'Forbidden',
					),
					'headers'  => array(),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$request->set_param( 'type', 'activity' );
		$request->set_param( 'id', $activity_id );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'pre_http_request', $callback, 10 );
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $activity_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'embeddable' => false,
				'status'     => 403,
			),
			$response->get_data()
		);
	}

	/**
	 * Endpoint must reject anonymous traffic — the preflight causes
	 * outbound HTTP, so leaving it open to unauthenticated callers would
	 * hand the world a free reflective fetch.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_requires_editor_capability(): void {
		wp_set_current_user( 0 );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$request->set_param( 'type', 'activity' );
		$request->set_param( 'id', '12345' );

		$response = rest_get_server()->dispatch( $request );

		// Either 401 or 403 is acceptable here; both signal "go authenticate".
		$this->assertContains( $response->get_status(), array( 401, 403 ) );
	}

	/**
	 * Subscribers are logged in but lack `edit_posts`, so the gate must
	 * reject them. Without this, a future "fix" relaxing the check to
	 * `is_user_logged_in()` would expose the reflective HEAD probe to
	 * every customer on a WooCommerce site.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_rejects_subscriber(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $user_id );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$request->set_param( 'type', 'activity' );
		$request->set_param( 'id', '12345' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertContains( $response->get_status(), array( 401, 403 ) );
	}

	/**
	 * A non-numeric ID must 400 before any HTTP fan-out.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_rejects_non_numeric_id(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$request->set_param( 'type', 'activity' );
		$request->set_param( 'id', 'abc' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * Unsupported `type` (anything outside activity/route/segment) must 400
	 * — Strava's iframe paths are limited to those three.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_rejects_unknown_type(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$request->set_param( 'type', 'club' );
		$request->set_param( 'id', '123' );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * Network failure during the preflight reports `embeddable: false` with
	 * status 0 — no false-positives on a transient blip.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_reports_zero_on_transport_failure(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$activity_id = '66666666666';
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $activity_id ) );

		$callback = static function ( $preempt, $args, $url ) use ( $activity_id ) {
			if ( str_contains( $url, 'strava-embeds.com/activity/' . $activity_id ) ) {
				return new WP_Error( 'http_failed', 'simulated' );
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$request->set_param( 'type', 'activity' );
		$request->set_param( 'id', $activity_id );

		$response = rest_get_server()->dispatch( $request );

		remove_filter( 'pre_http_request', $callback, 10 );
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $activity_id ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'embeddable' => false,
				'status'     => 0,
			),
			$response->get_data()
		);
	}

	/**
	 * Cache keys must include the embed type, not just the resource ID —
	 * a route and an activity can share a numeric ID space (Strava doesn't
	 * promise otherwise) and a key collision would silently serve the
	 * wrong probe result across types. Pins the type prefix before someone
	 * "simplifies" `md5( $type . ':' . $id )` to `md5( $id )`.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_does_not_collide_across_types(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$shared_id = '99999999999';
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $shared_id ) );
		delete_transient( 'block_for_strava_embed_status_' . md5( 'route:' . $shared_id ) );

		$callback = static function ( $preempt, $args, $url ) use ( $shared_id ) {
			if ( str_contains( $url, '/activity/' . $shared_id ) ) {
				return array(
					'response' => array(
						'code'    => 403,
						'message' => 'Forbidden',
					),
					'headers'  => array(),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			if ( str_contains( $url, '/route/' . $shared_id ) ) {
				return array(
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'headers'  => array(),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$req_a = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$req_a->set_param( 'type', 'activity' );
		$req_a->set_param( 'id', $shared_id );
		$req_r = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$req_r->set_param( 'type', 'route' );
		$req_r->set_param( 'id', $shared_id );

		$activity_data = rest_get_server()->dispatch( $req_a )->get_data();
		$route_data    = rest_get_server()->dispatch( $req_r )->get_data();

		remove_filter( 'pre_http_request', $callback, 10 );
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $shared_id ) );
		delete_transient( 'block_for_strava_embed_status_' . md5( 'route:' . $shared_id ) );

		$this->assertSame(
			array(
				'embeddable' => false,
				'status'     => 403,
			),
			$activity_data
		);
		$this->assertSame(
			array(
				'embeddable' => true,
				'status'     => 200,
			),
			$route_data
		);
	}

	/**
	 * Status results must be cached in a transient so a typing user (who
	 * triggers the editor's effect on every URL change) doesn't fan out
	 * into one HTTP HEAD per keystroke.
	 *
	 * @covers Block_For_Strava_Embed::register_rest_routes
	 */
	public function test_rest_embed_status_caches_result(): void {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$activity_id = '77777777777';
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $activity_id ) );

		$http_calls = 0;
		$callback   = static function ( $preempt, $args, $url ) use ( $activity_id, &$http_calls ) {
			if ( str_contains( $url, 'strava-embeds.com/activity/' . $activity_id ) ) {
				++$http_calls;
				return array(
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'headers'  => array(),
					'body'     => '',
					'cookies'  => array(),
					'filename' => '',
				);
			}
			return $preempt;
		};
		add_filter( 'pre_http_request', $callback, 10, 3 );

		$request = new WP_REST_Request( 'GET', '/block-for-strava/v1/embed-status' );
		$request->set_param( 'type', 'activity' );
		$request->set_param( 'id', $activity_id );

		rest_get_server()->dispatch( $request );
		rest_get_server()->dispatch( $request );

		remove_filter( 'pre_http_request', $callback, 10 );
		delete_transient( 'block_for_strava_embed_status_' . md5( 'activity:' . $activity_id ) );

		$this->assertSame( 1, $http_calls, 'Second dispatch should hit the cache.' );
	}
}
