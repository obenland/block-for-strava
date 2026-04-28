import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

function wp( args: string ): string {
	return execSync( `npx wp-env run cli wp ${ args }`, {
		stdio: [ 'ignore', 'pipe', 'inherit' ],
		cwd: process.cwd(),
	} )
		.toString()
		.trim();
}

async function loginAsAdmin( page: Page ): Promise< void > {
	await page.goto( '/wp-login.php' );
	await page.locator( '#user_login' ).fill( 'admin' );
	await page.locator( '#user_pass' ).fill( 'password' );
	await page.locator( '#wp-submit' ).click();
	await page.waitForURL( /wp-admin/ );
}

async function waitForEditor( page: Page ): Promise< void > {
	// Wait for the editor iframe to be present in the DOM.
	await page
		.locator( 'iframe[name="editor-canvas"]' )
		.waitFor( { timeout: 15000 } );

	// Dismiss the welcome guide if shown.
	const guide = page.getByRole( 'dialog', { name: /welcome/i } );
	if ( await guide.isVisible( { timeout: 2000 } ).catch( () => false ) ) {
		await guide.getByRole( 'button', { name: /close/i } ).click();
	}
}

test.describe.serial( 'Strava Activity block', () => {
	let postId: string;

	test.afterEach( () => {
		if ( postId ) {
			wp( `post delete ${ postId } --force` );
			postId = '';
		}
	} );

	test( 'frontend render: embed has correct attributes', async ( {
		page,
	} ) => {
		postId = wp(
			'post create --post_title="Strava E2E" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } '--post_content=<!-- wp:obenland/strava-activity {"activityId":"18233733854","url":"https://www.strava.com/activities/18233733854"} /-->'`
		);

		// Block strava-embeds.com so embed.js can't replace the placeholder.
		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );

		await page.goto( `/?p=${ postId }` );

		const wrapper = page.locator( '.wp-block-obenland-strava-activity' );
		await expect( wrapper ).toBeAttached();

		const placeholder = wrapper.locator( '.strava-embed-placeholder' );
		await expect( placeholder ).toBeAttached();
		await expect( placeholder ).toHaveAttribute(
			'data-embed-id',
			'18233733854'
		);
		await expect( placeholder ).toHaveAttribute( 'data-style', 'standard' );
		await expect( placeholder ).toHaveAttribute(
			'data-embed-type',
			'activity'
		);
	} );

	test( 'frontend render: route embed has data-embed-type="route"', async ( {
		page,
	} ) => {
		const routeId = '3379104463896442748';
		postId = wp(
			'post create --post_title="Strava E2E Route" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } '--post_content=<!-- wp:obenland/strava-activity {"activityId":"${ routeId }","embedType":"route","url":"https://www.strava.com/routes/${ routeId }"} /-->'`
		);

		// Block strava-embeds.com so embed.js can't replace the placeholder.
		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );

		await page.goto( `/?p=${ postId }` );

		const placeholder = page
			.locator( '.wp-block-obenland-strava-activity' )
			.locator( '.strava-embed-placeholder' );
		await expect( placeholder ).toBeAttached();
		await expect( placeholder ).toHaveAttribute( 'data-embed-id', routeId );
		await expect( placeholder ).toHaveAttribute(
			'data-embed-type',
			'route'
		);
		await expect( placeholder ).toHaveAttribute( 'data-style', 'standard' );
	} );

	test( 'frontend render: caption is wrapped in figcaption', async ( {
		page,
	} ) => {
		postId = wp(
			'post create --post_title="Strava E2E Caption" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } '--post_content=<!-- wp:obenland/strava-activity {"activityId":"18233733854","url":"https://www.strava.com/activities/18233733854","caption":"Morning ride"} /-->'`
		);

		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );

		const figure = page.locator(
			'figure.wp-block-obenland-strava-activity'
		);
		await expect( figure ).toBeAttached();

		const caption = figure.locator( 'figcaption.wp-element-caption' );
		await expect( caption ).toHaveText( 'Morning ride' );
	} );

	test( 'editor: block inserts and shows placeholder', async ( { page } ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await waitForEditor( page );

		const canvas = page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.first();

		// Click in the canvas to focus the editor, then type slash command.
		await canvas.locator( 'body' ).click();
		await page.keyboard.type( '/Strava Activity' );
		await page
			.getByRole( 'option', { name: /strava activity/i } )
			.first()
			.click();

		await expect(
			canvas.locator( '.components-placeholder', {
				hasText: 'Strava Activity',
			} )
		).toBeVisible();
	} );

	test( 'editor: embedding a URL shows iframe preview', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/post-new.php' );
		await waitForEditor( page );

		const canvas = page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.first();

		await canvas.locator( 'body' ).click();
		await page.keyboard.type( '/Strava Activity' );
		await page
			.getByRole( 'option', { name: /strava activity/i } )
			.first()
			.click();

		await canvas
			.locator( '.wp-block-obenland-strava-activity input[type="text"]' )
			.fill( 'https://www.strava.com/activities/18233733854' );
		await canvas
			.locator(
				'.wp-block-obenland-strava-activity button[type="submit"]'
			)
			.click();

		await expect(
			canvas.locator( '.wp-block-obenland-strava-activity iframe' )
		).toBeVisible();
	} );

	test( 'frontend render: route with all options set serializes every data-* attribute', async ( {
		page,
	} ) => {
		const routeId = '3379104463896442748';
		const attrs = {
			activityId: routeId,
			embedType: 'route',
			url: `https://www.strava.com/routes/${ routeId }`,
			routeShowElevation: false,
			routeUnits: 'metric',
			routeFullWidth: true,
			routeMapStyle: 'satellite',
			routeTerrain: '3d',
			routeShowDirt: true,
		};
		postId = wp(
			'post create --post_title="Strava E2E Route Options" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } '--post_content=<!-- wp:obenland/strava-activity ${ JSON.stringify(
				attrs
			) } /-->'`
		);

		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );

		const placeholder = page
			.locator( '.wp-block-obenland-strava-activity' )
			.locator( '.strava-embed-placeholder' );
		await expect( placeholder ).toHaveAttribute(
			'data-embed-type',
			'route'
		);
		await expect( placeholder ).toHaveAttribute(
			'data-style',
			'satellite'
		);
		await expect( placeholder ).toHaveAttribute(
			'data-hide-elevation',
			'true'
		);
		await expect( placeholder ).toHaveAttribute( 'data-units', 'metric' );
		await expect( placeholder ).toHaveAttribute(
			'data-full-width',
			'true'
		);
		await expect( placeholder ).toHaveAttribute( 'data-terrain', '3d' );
		await expect( placeholder ).toHaveAttribute(
			'data-surface-type',
			'true'
		);
	} );

	test( 'frontend render: route at defaults emits only data-style="standard"', async ( {
		page,
	} ) => {
		const routeId = '3379104463896442748';
		postId = wp(
			'post create --post_title="Strava E2E Route Defaults" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } '--post_content=<!-- wp:obenland/strava-activity {"activityId":"${ routeId }","embedType":"route","url":"https://www.strava.com/routes/${ routeId }"} /-->'`
		);

		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );

		const placeholder = page
			.locator( '.wp-block-obenland-strava-activity' )
			.locator( '.strava-embed-placeholder' );
		await expect( placeholder ).toHaveAttribute( 'data-style', 'standard' );

		/*
		 * The other route-only knobs should be absent at defaults so Strava
		 * falls back to its own defaults inside the iframe.
		 */
		for ( const attr of [
			'data-hide-elevation',
			'data-units',
			'data-full-width',
			'data-terrain',
			'data-surface-type',
		] ) {
			await expect( placeholder ).not.toHaveAttribute( attr, /.*/ );
		}
	} );

	test( 'frontend render: activity ignores route options and stays at data-style="standard"', async ( {
		page,
	} ) => {
		const attrs = {
			activityId: '18233733854',
			embedType: 'activity',
			url: 'https://www.strava.com/activities/18233733854',
			routeMapStyle: 'satellite',
			routeFullWidth: true,
			routeShowDirt: true,
		};
		postId = wp(
			'post create --post_title="Strava E2E Activity Ignores Route" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } '--post_content=<!-- wp:obenland/strava-activity ${ JSON.stringify(
				attrs
			) } /-->'`
		);

		await page.route( /strava-embeds\.com/, ( route ) => route.abort() );
		await page.goto( `/?p=${ postId }` );

		const placeholder = page
			.locator( '.wp-block-obenland-strava-activity' )
			.locator( '.strava-embed-placeholder' );
		await expect( placeholder ).toHaveAttribute(
			'data-embed-type',
			'activity'
		);
		await expect( placeholder ).toHaveAttribute( 'data-style', 'standard' );
		await expect( placeholder ).not.toHaveAttribute(
			'data-full-width',
			/.*/
		);
		await expect( placeholder ).not.toHaveAttribute(
			'data-surface-type',
			/.*/
		);
	} );

	test( 'editor: route embed exposes the Route options sidebar', async ( {
		page,
	} ) => {
		const routeId = '3379104463896442748';
		postId = wp(
			'post create --post_title="Strava E2E Route Sidebar" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } '--post_content=<!-- wp:obenland/strava-activity {"activityId":"${ routeId }","embedType":"route","url":"https://www.strava.com/routes/${ routeId }"} /-->'`
		);

		await loginAsAdmin( page );
		await page.goto( `/wp-admin/post.php?post=${ postId }&action=edit` );
		await waitForEditor( page );

		const canvas = page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.first();
		await canvas.locator( '.wp-block-obenland-strava-activity' ).click();

		/*
		 * Open the block-settings sidebar in case it's collapsed. Skip if the
		 * panel is already discoverable in the document — keeps the test
		 * resilient across editor layouts where the sidebar opens by default.
		 */
		const panelTitle = page.getByRole( 'button', {
			name: /route options/i,
		} );
		if ( ! ( await panelTitle.isVisible().catch( () => false ) ) ) {
			const settingsToggle = page.getByRole( 'button', {
				name: /^settings$/i,
			} );
			if ( await settingsToggle.isVisible().catch( () => false ) ) {
				await settingsToggle.click();
			}
		}

		await expect( panelTitle ).toBeVisible();
	} );

	test( 'editor: activity embed does not expose the Route options sidebar', async ( {
		page,
	} ) => {
		postId = wp(
			'post create --post_title="Strava E2E Activity Sidebar" --post_status=publish --porcelain'
		);
		wp(
			`post update ${ postId } '--post_content=<!-- wp:obenland/strava-activity {"activityId":"18233733854","embedType":"activity","url":"https://www.strava.com/activities/18233733854"} /-->'`
		);

		await loginAsAdmin( page );
		await page.goto( `/wp-admin/post.php?post=${ postId }&action=edit` );
		await waitForEditor( page );

		const canvas = page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.first();
		await canvas.locator( '.wp-block-obenland-strava-activity' ).click();

		const settingsToggle = page.getByRole( 'button', {
			name: /^settings$/i,
		} );
		if ( await settingsToggle.isVisible().catch( () => false ) ) {
			await settingsToggle.click();
		}

		await expect(
			page.getByRole( 'button', { name: /route options/i } )
		).toHaveCount( 0 );
	} );
} );
