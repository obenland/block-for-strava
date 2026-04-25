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

const ADMIN_USER_ID = '1';

const FAKE_TOKEN = JSON.stringify({
	access_token: 'test-access-token',
	refresh_token: 'test-refresh-token',
	expires_at: 99999999999,
	athlete: {
		id: 99,
		firstname: 'Test',
		lastname: 'Runner',
		profile: '',
	},
});

const FAKE_ACTIVITIES = [
	{
		id: '11111',
		name: 'Morning Run',
		type: 'Run',
		distance: 5012.7,
		startDate: '2026-04-21T08:00:00Z',
		private: false,
	},
	{
		id: '22222',
		name: 'Evening Ride',
		type: 'Ride',
		distance: 32104.2,
		startDate: '2026-04-22T19:00:00Z',
		private: true,
	},
];

function setAdminToken(): void {
	wp(
		`user meta update ${ADMIN_USER_ID} _block_for_strava_token '${FAKE_TOKEN}' --format=json`
	);
}

function clearAdminToken(): void {
	try {
		wp(`user meta delete ${ADMIN_USER_ID} _block_for_strava_token`);
	} catch {
		// already absent
	}
}

async function loginAsAdmin(page: Page): Promise<void> {
	await page.goto('/wp-login.php');
	await page.locator('#user_login').fill('admin');
	await page.locator('#user_pass').fill('password');
	await page.locator('#wp-submit').click();
	await page.waitForURL(/wp-admin/);
}

async function waitForEditor(page: Page): Promise<void> {
	await page
		.locator('iframe[name="editor-canvas"]')
		.waitFor({ timeout: 15000 });
	const guide = page.getByRole('dialog', { name: /welcome/i });
	if (await guide.isVisible({ timeout: 2000 }).catch(() => false)) {
		await guide.getByRole('button', { name: /close/i }).click();
	}
}

async function insertStravaBlock(page: Page): Promise<void> {
	const canvas = page.frameLocator('iframe[name="editor-canvas"]').first();
	await canvas.locator('body').click();
	await page.keyboard.type('/Strava Activity');
	await page
		.getByRole('option', { name: /strava activity/i })
		.first()
		.click();
}

test.describe.serial('Strava OAuth flows', () => {
	test.afterEach(() => {
		clearAdminToken();
	});

	test('disconnected: block shows Connect to Strava button', async ({
		page,
	}) => {
		clearAdminToken();
		await loginAsAdmin(page);
		await page.goto('/wp-admin/post-new.php');
		await waitForEditor(page);
		await insertStravaBlock(page);

		const canvas = page
			.frameLocator('iframe[name="editor-canvas"]')
			.first();
		await expect(
			canvas.getByRole('button', { name: /connect to strava/i })
		).toBeVisible();
	});

	test('connected: activity picker lists activities and picking one embeds it', async ({
		page,
	}) => {
		setAdminToken();

		await page.route(
			/\/wp-json\/block-for-strava\/v1\/activities/,
			(route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ activities: FAKE_ACTIVITIES }),
				})
		);

		await loginAsAdmin(page);
		await page.goto('/wp-admin/post-new.php');
		await waitForEditor(page);
		await insertStravaBlock(page);

		const canvas = page
			.frameLocator('iframe[name="editor-canvas"]')
			.first();

		const morning = canvas.getByRole('button', { name: /morning run/i });
		await expect(morning).toBeVisible();
		await expect(
			canvas.getByRole('button', { name: /evening ride/i })
		).toBeVisible();

		await morning.click();

		await expect(
			canvas.locator('.wp-block-obenland-strava-activity iframe')
		).toBeVisible();
	});

	test('connected: disconnect button clears the connection', async ({
		page,
	}) => {
		setAdminToken();
		await page.route(
			/\/wp-json\/block-for-strava\/v1\/activities/,
			(route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ activities: FAKE_ACTIVITIES }),
				})
		);

		await loginAsAdmin(page);
		await page.goto('/wp-admin/post-new.php');
		await waitForEditor(page);
		await insertStravaBlock(page);

		const canvas = page
			.frameLocator('iframe[name="editor-canvas"]')
			.first();
		await expect(
			canvas.getByRole('button', { name: /morning run/i })
		).toBeVisible();

		// Open the Strava Account inspector panel and click Disconnect.
		const accountPanel = page.getByRole('button', {
			name: /strava account/i,
		});
		if (
			(await accountPanel
				.getAttribute('aria-expanded')
				.catch(() => 'true')) === 'false'
		) {
			await accountPanel.click();
		}
		await page.getByRole('button', { name: /^disconnect$/i }).click();

		await expect(
			canvas.getByRole('button', { name: /connect to strava/i })
		).toBeVisible();
	});

	test('URL fallback still works when not connected', async ({ page }) => {
		clearAdminToken();
		await loginAsAdmin(page);
		await page.goto('/wp-admin/post-new.php');
		await waitForEditor(page);
		await insertStravaBlock(page);

		const canvas = page
			.frameLocator('iframe[name="editor-canvas"]')
			.first();

		// URL fallback form is open by default when not connected.
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
