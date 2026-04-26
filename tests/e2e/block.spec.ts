import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

function wp(args: string): string {
	return execSync(`npx wp-env run cli wp ${args}`, {
		stdio: ['ignore', 'pipe', 'inherit'],
		cwd: process.cwd(),
	})
		.toString()
		.trim();
}

async function loginAsAdmin(page: Page): Promise<void> {
	await page.goto('/wp-login.php');
	await page.locator('#user_login').fill('admin');
	await page.locator('#user_pass').fill('password');
	await page.locator('#wp-submit').click();
	await page.waitForURL(/wp-admin/);
}

async function waitForEditor(page: Page): Promise<void> {
	// Wait for the editor iframe to be present in the DOM.
	await page
		.locator('iframe[name="editor-canvas"]')
		.waitFor({ timeout: 15000 });

	// Dismiss the welcome guide if shown.
	const guide = page.getByRole('dialog', { name: /welcome/i });
	if (await guide.isVisible({ timeout: 2000 }).catch(() => false)) {
		await guide.getByRole('button', { name: /close/i }).click();
	}
}

test.describe.serial('Strava Activity block', () => {
	let postId: string;

	test.afterEach(() => {
		if (postId) {
			wp(`post delete ${postId} --force`);
			postId = '';
		}
	});

	test('frontend render: embed has correct attributes', async ({ page }) => {
		postId = wp(
			'post create --post_title="Strava E2E" --post_status=publish --porcelain'
		);
		wp(
			`post update ${postId} '--post_content=<!-- wp:obenland/strava-activity {"activityId":"18233733854","url":"https://www.strava.com/activities/18233733854"} /-->'`
		);

		// Block strava-embeds.com so embed.js can't replace the placeholder.
		await page.route(/strava-embeds\.com/, (route) => route.abort());

		await page.goto(`/?p=${postId}`);

		const wrapper = page.locator('.wp-block-obenland-strava-activity');
		await expect(wrapper).toBeAttached();

		const placeholder = wrapper.locator('.strava-embed-placeholder');
		await expect(placeholder).toBeAttached();
		await expect(placeholder).toHaveAttribute(
			'data-embed-id',
			'18233733854'
		);
		await expect(placeholder).toHaveAttribute('data-style', 'standard');
		await expect(placeholder).toHaveAttribute(
			'data-embed-type',
			'activity'
		);
	});

	test('frontend render: caption is wrapped in figcaption', async ({
		page,
	}) => {
		postId = wp(
			'post create --post_title="Strava E2E Caption" --post_status=publish --porcelain'
		);
		wp(
			`post update ${postId} '--post_content=<!-- wp:obenland/strava-activity {"activityId":"18233733854","url":"https://www.strava.com/activities/18233733854","caption":"Morning ride"} /-->'`
		);

		await page.route(/strava-embeds\.com/, (route) => route.abort());
		await page.goto(`/?p=${postId}`);

		const figure = page.locator('figure.wp-block-obenland-strava-activity');
		await expect(figure).toBeAttached();

		const caption = figure.locator('figcaption.wp-element-caption');
		await expect(caption).toHaveText('Morning ride');
	});

	test('editor: block inserts and shows placeholder', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/post-new.php');
		await waitForEditor(page);

		const canvas = page
			.frameLocator('iframe[name="editor-canvas"]')
			.first();

		// Click in the canvas to focus the editor, then type slash command.
		await canvas.locator('body').click();
		await page.keyboard.type('/Strava Activity');
		await page
			.getByRole('option', { name: /strava activity/i })
			.first()
			.click();

		await expect(
			canvas.locator('.components-placeholder', {
				hasText: 'Strava Activity',
			})
		).toBeVisible();
	});

	test('editor: embedding a URL shows iframe preview', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/post-new.php');
		await waitForEditor(page);

		const canvas = page
			.frameLocator('iframe[name="editor-canvas"]')
			.first();

		await canvas.locator('body').click();
		await page.keyboard.type('/Strava Activity');
		await page
			.getByRole('option', { name: /strava activity/i })
			.first()
			.click();

		await canvas
			.locator('.wp-block-obenland-strava-activity input[type="text"]')
			.fill('https://www.strava.com/activities/18233733854');
		await canvas
			.locator('.wp-block-obenland-strava-activity button[type="submit"]')
			.click();

		await expect(
			canvas.locator('.wp-block-obenland-strava-activity iframe')
		).toBeVisible();
	});
});
