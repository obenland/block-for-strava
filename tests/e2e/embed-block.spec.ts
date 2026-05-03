import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

/**
 * End-to-end coverage for the `block-for-strava/embed` block.
 *
 * Four seams to pin:
 *
 * 1. A saved post containing a Strava URL in the block-comment
 *    attributes renders as an iframe pointing directly at
 *    strava-embeds.com via the block's `render_callback`, with the
 *    defense-in-depth sandbox flags and `referrerpolicy=origin` intact.
 * 2. The block is registered in the editor's `core/blocks` data store
 *    so it shows up in the inserter — pinned via a data-store read
 *    rather than UI clicks because inserter accessible names drift
 *    across Gutenberg versions.
 * 3. Pasting a Strava URL or share-dialog snippet into post content
 *    yields a `block-for-strava/embed` block automatically, regardless
 *    of which of the four supported input forms the user pastes.
 * 4. A `core/embed` block whose URL is later set to a Strava form is
 *    convertible into our block via the toolbar `Transform to` menu —
 *    the declarative fallback for cases where the auto-replace
 *    subscriber wasn't running (e.g., a pre-existing post imported
 *    with a generic embed block).
 */

/**
 * Runs a wp-cli command inside the wp-env container.
 *
 * @param args Arguments to append after `wp` in the container.
 */
function wp( args: string ): string {
	return execSync( `npx wp-env run cli wp ${ args }`, {
		stdio: [ 'ignore', 'pipe', 'inherit' ],
		cwd: process.cwd(),
	} )
		.toString()
		.trim();
}

/**
 * Logs into wp-admin as the default admin user.
 *
 * @param page Playwright page.
 */
async function loginAsAdmin( page: Page ): Promise< void > {
	await page.goto( '/wp-login.php' );
	await page.locator( '#user_login' ).fill( 'admin' );
	await page.locator( '#user_pass' ).fill( 'password' );
	await page.locator( '#wp-submit' ).click();
	await page.waitForURL( /wp-admin/ );
}

/**
 * Waits for the block editor canvas iframe and dismisses the welcome guide.
 *
 * @param page Playwright page.
 */
async function waitForEditor( page: Page ): Promise< void > {
	await page
		.locator( 'iframe[name="editor-canvas"]' )
		.waitFor( { timeout: 15000 } );
	const guide = page.getByRole( 'dialog', { name: /welcome/i } );
	if ( await guide.isVisible( { timeout: 2000 } ).catch( () => false ) ) {
		await guide.getByRole( 'button', { name: /close/i } ).click();
	}
}

/**
 * Publishes a post with a serialized `block-for-strava/embed` block carrying
 * the supplied attributes. Returning the post ID synchronously lets the
 * caller assign it into the test's outer `postId` *before* any async assert
 * runs — otherwise a failed expect inside a helper would leak a published
 * post that `afterEach` can't see.
 *
 * @param title Post title.
 * @param attrs Block attributes (must include `url`).
 */
function publishStravaBlock(
	title: string,
	attrs: Record< string, unknown >
): string {
	// Dynamic block: `save` returns null, so the persisted comment carries
	// only attributes — the PHP render callback rebuilds the figure.
	const blockComment = `<!-- wp:block-for-strava/embed ${ JSON.stringify(
		attrs
	) } /-->`;
	const postId = wp(
		`post create --post_title=${ JSON.stringify(
			title
		) } --post_status=publish --porcelain`
	);
	wp(
		`post update ${ postId } --post_content=${ JSON.stringify(
			blockComment
		) }`
	);
	return postId;
}

/**
 * Loads the published post and returns the `src` of the Strava embed iframe.
 * Blocks strava-embeds.com so the test doesn't depend on the upstream embed
 * page actually loading; the URL on the iframe is the contract we own.
 *
 * @param page   Playwright page.
 * @param postId Post ID returned by `publishStravaBlock`.
 */
async function fetchEmbedIframeSrc(
	page: Page,
	postId: string
): Promise< string > {
	await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
	await page.goto( `/?p=${ postId }` );

	const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
	await expect( iframe ).toBeAttached();
	return ( await iframe.getAttribute( 'src' ) ) ?? '';
}

const RENDER_CASES = [
	{
		name: 'activity',
		url: 'https://www.strava.com/activities/18233733854',
		expectedSrc: 'https://strava-embeds.com/activity/18233733854',
	},
	{
		name: 'route',
		url: 'https://www.strava.com/routes/3379104463896442748',
		expectedSrc: 'https://strava-embeds.com/route/3379104463896442748',
	},
	{
		name: 'segment',
		url: 'https://www.strava.com/segments/789',
		expectedSrc: 'https://strava-embeds.com/segment/789',
	},
] as const;

test.describe.serial( 'block-for-strava/embed render', () => {
	let postId: string;

	test.afterEach( () => {
		if ( postId ) {
			wp( `post delete ${ postId } --force` );
			postId = '';
		}
	} );

	for ( const { name, url, expectedSrc } of RENDER_CASES ) {
		test( `frontend: ${ name } URL renders via render_callback`, async ( {
			page,
		} ) => {
			postId = publishStravaBlock( `Strava ${ name } embed`, { url } );
			const src = await fetchEmbedIframeSrc( page, postId );
			expect( src ).toBe( expectedSrc );
		} );
	}

	test( 'frontend: route attributes append Strava URL params to the iframe', async ( {
		page,
	} ) => {
		const routeId = '3379104463896442748';
		const attrs = {
			url: `https://www.strava.com/routes/${ routeId }`,
			stravaRouteMapStyle: 'satellite',
			stravaRouteUnits: 'metric',
			stravaRouteFullWidth: true,
			stravaRouteShowDirt: true,
			stravaRouteTerrain: '3d',
			stravaRouteShowElevation: false,
		};
		postId = publishStravaBlock( 'Strava route options', attrs );

		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );

		const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
		const src = ( await iframe.getAttribute( 'src' ) ) ?? '';
		const url = new URL( src );
		expect( url.pathname ).toBe( `/route/${ routeId }` );
		expect( url.searchParams.get( 'style' ) ).toBe( 'satellite' );
		expect( url.searchParams.get( 'hideElevation' ) ).toBe( 'true' );
		expect( url.searchParams.get( 'units' ) ).toBe( 'metric' );
		expect( url.searchParams.get( 'fullWidth' ) ).toBe( 'true' );
		expect( url.searchParams.get( 'terrain' ) ).toBe( '3d' );
		expect( url.searchParams.get( 'surfaceType' ) ).toBe( 'true' );
	} );

	test( 'frontend: iframe carries the defense-in-depth sandbox + referrer-policy attributes', async ( {
		page,
	} ) => {
		postId = publishStravaBlock( 'Strava sandbox attrs', {
			url: 'https://www.strava.com/activities/18233733854',
		} );
		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );
		const iframe = page.locator( 'iframe.strava-embed-iframe' ).first();
		await expect( iframe ).toHaveAttribute(
			'sandbox',
			'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'
		);
		await expect( iframe ).toHaveAttribute( 'referrerpolicy', 'origin' );
	} );

	test( 'editor: pasted Strava snippet survives the paste pipeline as a tokenized embed block', async ( {
		page,
	} ) => {
		// The Jest unit suite calls `isMatch`/`transform` directly on a
		// hand-built node, which bypasses Gutenberg's schema-based
		// `removeInvalidHTML` pass. Real-world paste hands the HTML to
		// `wp.blocks.pasteHandler`, which strips disallowed tags and
		// attributes BEFORE walking raw transforms. A raw transform without
		// a matching `schema` declaration sees the data-* attributes on the
		// placeholder div removed, so `parsePlaceholder` returns null and
		// the snippet falls through to a freeform/HTML block — token lost.
		// This test pins the round-trip through the real handler.
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await waitForEditor( page );

		// Synthetic ID + token: the test only validates that the paste
		// pipeline survives the schema filter and the transform's
		// attribute mapping is correct — no network request is made, so
		// real Strava values would only risk leaking a share token.
		const snippet =
			'<div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="99999999999" data-style="standard" data-from-embed="false" data-token="TEST-TOKEN-NOT-A-REAL-SHARE-TOKEN"></div><script src="https://strava-embeds.com/embed.js"></script>';

		const blocks = await page.evaluate( ( html: string ) => {
			const wpAny = ( window as { wp?: any } ).wp;
			const result = wpAny.blocks.pasteHandler( {
				HTML: html,
				mode: 'BLOCKS',
			} );
			const arr = Array.isArray( result ) ? result : [ result ];
			return arr.map( ( b: any ) => ( {
				name: b.name,
				attributes: b.attributes,
			} ) );
		}, snippet );

		expect( blocks ).toHaveLength( 1 );
		expect( blocks[ 0 ].name ).toBe( 'block-for-strava/embed' );
		expect( blocks[ 0 ].attributes.url ).toBe(
			'https://www.strava.com/activities/99999999999'
		);
		expect( blocks[ 0 ].attributes.stravaEmbedToken ).toBe(
			'TEST-TOKEN-NOT-A-REAL-SHARE-TOKEN'
		);
	} );

	/*
	 * The three URL shapes flow through the URL-paste path:
	 * `pasteHandler` builds a `core/embed` block and the auto-replace
	 * subscriber swaps it for ours. The share-dialog snippet (the
	 * fourth supported input) goes through the raw-transform path
	 * and is covered by the separate snippet test above.
	 */
	const PASTE_CASES = [
		{
			label: 'activity URL',
			input: 'https://www.strava.com/activities/18233733854',
			expectedUrl: 'https://www.strava.com/activities/18233733854',
			expectedToken: '',
		},
		{
			label: 'route URL',
			input: 'https://www.strava.com/routes/3379104463896442748',
			expectedUrl: 'https://www.strava.com/routes/3379104463896442748',
			expectedToken: '',
		},
		{
			label: 'short share URL',
			input: 'https://strava.app.link/5nv42wErO2b',
			expectedUrl: 'https://strava.app.link/5nv42wErO2b',
			expectedToken: '',
		},
	] as const;

	for ( const { label, input, expectedUrl, expectedToken } of PASTE_CASES ) {
		test( `editor: pasting a ${ label } into post content yields a Strava block`, async ( {
			page,
		} ) => {
			await loginAsAdmin( page );
			await page.goto( '/wp-admin/post-new.php' );
			await waitForEditor( page );

			/*
			 * Drive the same path the editor takes for a URL pasted on
			 * its own line: `pasteHandler` returns a `core/embed`,
			 * `replaceBlocks` inserts it where the cursor was, then the
			 * `subscribe`-based auto-replace fires and swaps it for our
			 * block. Wait on the observable state — the block name
			 * flipping to `block-for-strava/embed` — rather than a
			 * fixed timeout, so a slower CI scheduler can take longer
			 * without flaking the suite.
			 */
			await page.evaluate( async ( pastedUrl: string ) => {
				const wpAny = ( window as { wp?: any } ).wp;
				const empty = wpAny.blocks.createBlock( 'core/paragraph', {
					content: '',
				} );
				wpAny.data
					.dispatch( 'core/block-editor' )
					.resetBlocks( [ empty ] );
				const pasted = wpAny.blocks.pasteHandler( {
					HTML: pastedUrl,
					plainText: pastedUrl,
					mode: 'BLOCKS',
				} );
				const arr = Array.isArray( pasted ) ? pasted : [ pasted ];
				await wpAny.data
					.dispatch( 'core/block-editor' )
					.replaceBlocks( [ empty.clientId ], arr );
			}, input );

			const result = await expect
				.poll(
					async () =>
						page.evaluate( () => {
							const wpAny = ( window as { wp?: any } ).wp;
							const blocks = wpAny.data
								.select( 'core/block-editor' )
								.getBlocks();
							return blocks.map( ( b: any ) => ( {
								name: b.name,
								url: b.attributes?.url,
								token: b.attributes?.stravaEmbedToken,
							} ) );
						} ),
					{ timeout: 5000 }
				)
				.toEqual( [
					expect.objectContaining( {
						name: 'block-for-strava/embed',
						url: expectedUrl,
					} ),
				] );

			/*
			 * `expect.poll(...).toEqual(...)` returns void rather than
			 * the polled value (Playwright API), so re-read the final
			 * state to assert on the token attribute. By the time we
			 * reach this point the poll has confirmed the block was
			 * replaced — this read is a single sync hop, no waiting.
			 */
			void result;
			const finalState = await page.evaluate( () => {
				const wpAny = ( window as { wp?: any } ).wp;
				const blocks = wpAny.data
					.select( 'core/block-editor' )
					.getBlocks();
				return blocks.map( ( b: any ) => ( {
					token: b.attributes?.stravaEmbedToken,
				} ) );
			} );
			expect( finalState[ 0 ].token ?? '' ).toBe( expectedToken );
		} );
	}

	test( 'editor: setting a Strava URL on an empty Strava block input keeps the block as block-for-strava/embed', async ( {
		page,
	} ) => {
		/*
		 * The "block input" avenue: a user inserts the Strava block
		 * from the inserter and pastes a URL into the placeholder's
		 * URL input. The Edit component dispatches
		 * `setAttributes({ url })`, which becomes
		 * `updateBlockAttributes` in the data store. Pin that the
		 * block keeps its identity through that flow — i.e. nothing
		 * else (an aggressive transform, an over-broad filter) snatches
		 * it back to `core/embed`.
		 */
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await waitForEditor( page );

		await page.evaluate( async () => {
			const wpAny = ( window as { wp?: any } ).wp;
			const block = wpAny.blocks.createBlock(
				'block-for-strava/embed',
				{}
			);
			wpAny.data.dispatch( 'core/block-editor' ).resetBlocks( [ block ] );
			await wpAny.data
				.dispatch( 'core/block-editor' )
				.updateBlockAttributes( block.clientId, {
					url: 'https://www.strava.com/activities/18233733854',
				} );
		} );

		/*
		 * Poll on the observable state (block name + url) rather than a
		 * fixed timeout. `updateBlockAttributes` resolves before the
		 * next subscribe tick, so a slower scheduler could otherwise
		 * leave the read happening before the new attribute is visible
		 * via `getBlocks()`. Polling is also load-bearing if any
		 * future filter mid-flight transforms the block — we'd see a
		 * stable matching state, not a transient one.
		 */
		await expect
			.poll(
				async () =>
					page.evaluate( () => {
						const wpAny = ( window as { wp?: any } ).wp;
						const blocks = wpAny.data
							.select( 'core/block-editor' )
							.getBlocks();
						return blocks.map( ( b: any ) => ( {
							name: b.name,
							url: b.attributes?.url,
						} ) );
					} ),
				{ timeout: 5000 }
			)
			.toEqual( [
				{
					name: 'block-for-strava/embed',
					url: 'https://www.strava.com/activities/18233733854',
				},
			] );
	} );

	test( 'editor: a Strava URL inside a core/embed block is offered as a "Transform to" target', async ( {
		page,
	} ) => {
		/*
		 * The toolbar fallback: when an existing post is loaded with a
		 * `core/embed` block that pre-dates this plugin (or that the
		 * watcher's `lastBlocks` cache short-circuited past), the user
		 * can pick "Transform to → Strava" from the toolbar. Verifies
		 * the `from`-block transform on `block-for-strava/embed`
		 * reaches `getBlockTransforms` for `core/embed` and that its
		 * `isMatch` discriminates Strava URLs from non-Strava ones.
		 */
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await waitForEditor( page );

		const sourceMatchesStrava = await page.evaluate( () => {
			const wpAny = ( window as { wp?: any } ).wp;
			/*
			 * `getBlockTransforms('from', destinationName)` returns the
			 * `transforms.from` entries on the destination block, each
			 * carrying a `blocks` list of accepted source blocks. The
			 * one we registered targets `core/embed`, and its `isMatch`
			 * gates on a Strava URL — exercise both: the source-block
			 * declaration is what surfaces "Transform to" in the
			 * toolbar UI; `isMatch` is what filters it down to Strava
			 * URLs only.
			 */
			const from = wpAny.blocks.getBlockTransforms(
				'from',
				'block-for-strava/embed'
			);
			const target = ( from || [] ).find(
				( t: any ) =>
					t.type === 'block' &&
					Array.isArray( t.blocks ) &&
					t.blocks.includes( 'core/embed' )
			);
			if ( ! target ) {
				return null;
			}
			return {
				strava: target.isMatch( {
					url: 'https://www.strava.com/activities/18233733854',
				} ),
				youtube: target.isMatch( {
					url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				} ),
			};
		} );
		expect( sourceMatchesStrava ).toEqual( {
			strava: true,
			youtube: false,
		} );
	} );

	test( 'editor: block is registered in the editor data store', async ( {
		page,
	} ) => {
		// Block Directory's discovery process keys off block.json + the
		// editor finding the block at runtime — pin both by reading
		// `core/blocks` after the editor boots. This is version-resilient:
		// the inserter UI's accessible names drift across Gutenberg
		// versions, but `getBlockType('block-for-strava/embed')` is the
		// same call from WP 6.6 forward.
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await waitForEditor( page );

		const blockType = await page.evaluate( () => {
			const wpAny = ( window as { wp?: any } ).wp;
			return wpAny?.data
				?.select( 'core/blocks' )
				?.getBlockType( 'block-for-strava/embed' );
		} );

		expect( blockType ).toBeTruthy();
		expect( blockType.name ).toBe( 'block-for-strava/embed' );
		expect( blockType.category ).toBe( 'embed' );
		// Title is wrapped in `__()` for translation, so the literal value
		// shifts with locale. Pin "is non-empty" here; the source-language
		// string is asserted in tests/js/block-json-consistency.test.ts.
		expect( blockType.title ).toBeTruthy();
		expect( typeof blockType.attributes ).toBe( 'object' );
		expect( blockType.attributes.url ).toBeTruthy();
	} );
} );
