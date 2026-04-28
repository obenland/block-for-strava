import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiFetch from '@wordpress/api-fetch';
import Edit from '../../src/edit';

jest.mock('@wordpress/api-fetch', () => ({
	__esModule: true,
	default: jest.fn(),
}));

const mockedApiFetch = jest.mocked(apiFetch);

function getIframe(container: HTMLElement): HTMLIFrameElement {
	const iframe = container.querySelector('iframe');
	expect(iframe).toBeInTheDocument();
	return iframe as HTMLIFrameElement;
}

function extractEmbedId(iframe: HTMLIFrameElement): string {
	const srcDoc = iframe.getAttribute('srcdoc') ?? '';
	const idMatch = srcDoc.match(/var n="([^"]+)"/);
	expect(idMatch).not.toBeNull();
	return idMatch![1];
}

type EmbedType = 'activity' | 'route' | 'segment';

interface RenderEditOptions {
	activityId?: string;
	embedType?: EmbedType;
	caption?: string;
	url?: string;
	isSelected?: boolean;
}

function renderEdit(options: RenderEditOptions = {}) {
	const setAttributes = jest.fn();
	const attributes = {
		url: options.url ?? '',
		activityId: options.activityId ?? '',
		embedType: options.embedType ?? ('activity' as EmbedType),
		caption: options.caption ?? '',
	};
	const utils = render(
		<Edit
			attributes={attributes}
			setAttributes={setAttributes}
			isSelected={options.isSelected ?? false}
		/>
	);
	return { ...utils, setAttributes, attributes };
}

beforeEach(() => {
	mockedApiFetch.mockReset();
});

describe('Edit – placeholder (editing) mode', () => {
	it('renders the placeholder when no activity is set', () => {
		renderEdit();
		expect(screen.getByTestId('placeholder')).toBeInTheDocument();
		expect(
			screen.getByPlaceholderText('https://www.strava.com/activities/…')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Embed' })
		).toBeInTheDocument();
	});

	it('shows an error when submitting an empty URL', async () => {
		const user = userEvent.setup();
		renderEdit();
		await user.click(screen.getByRole('button', { name: 'Embed' }));
		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('Please enter a URL.');
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('shows an error when the URL is not a Strava URL', async () => {
		const user = userEvent.setup();
		renderEdit();
		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://example.com/some-page'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));
		expect(
			await screen.findByText(
				/valid Strava activity, route, or segment URL/i
			)
		).toBeInTheDocument();
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('parses an embed snippet without calling the REST endpoint', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();
		const snippet =
			'<div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="123456789" data-style="standard"></div>';

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			snippet
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(setAttributes).toHaveBeenCalledWith({
			url: snippet,
			activityId: '123456789',
			embedType: 'activity',
		});
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('parses a route embed snippet and stores embedType=route', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();
		const snippet =
			'<div class="strava-embed-placeholder" data-embed-type="route" data-embed-id="555"></div>';

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			snippet
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(setAttributes).toHaveBeenCalledWith({
			url: snippet,
			activityId: '555',
			embedType: 'route',
		});
	});

	it('defaults to embedType=activity when the snippet has no data-embed-type', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();
		const snippet =
			'<div class="strava-embed-placeholder" data-embed-id="987654321"></div>';

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			snippet
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(setAttributes).toHaveBeenCalledWith({
			url: snippet,
			activityId: '987654321',
			embedType: 'activity',
		});
	});

	it('parses a canonical activity URL locally without calling the REST endpoint', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://www.strava.com/activities/111'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(setAttributes).toHaveBeenCalledWith({
			url: 'https://www.strava.com/activities/111',
			activityId: '111',
			embedType: 'activity',
		});
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('parses a canonical route URL locally with embedType=route', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://www.strava.com/routes/777'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(setAttributes).toHaveBeenCalledWith({
			url: 'https://www.strava.com/routes/777',
			activityId: '777',
			embedType: 'route',
		});
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('parses a canonical segment URL locally with embedType=segment', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://www.strava.com/segments/888'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(setAttributes).toHaveBeenCalledWith({
			url: 'https://www.strava.com/segments/888',
			activityId: '888',
			embedType: 'segment',
		});
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('rejects look-alike hosts like evilstrava.com', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://evilstrava.com/activities/111'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(
			await screen.findByText(
				/valid Strava activity, route, or segment URL/i
			)
		).toBeInTheDocument();
		expect(setAttributes).not.toHaveBeenCalled();
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('rejects unparseable URLs', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'not a url'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(
			await screen.findByText(
				/valid Strava activity, route, or segment URL/i
			)
		).toBeInTheDocument();
		expect(setAttributes).not.toHaveBeenCalled();
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('rejects strava.com URLs whose path is not an activity, route, or segment', async () => {
		const user = userEvent.setup();
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://www.strava.com/blog/some-post'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(
			await screen.findByText(
				/valid Strava activity, route, or segment URL/i
			)
		).toBeInTheDocument();
		expect(setAttributes).not.toHaveBeenCalled();
		expect(mockedApiFetch).not.toHaveBeenCalled();
	});

	it('resolves a short strava.app.link URL via apiFetch and falls back to embedType=activity', async () => {
		const user = userEvent.setup();
		mockedApiFetch.mockResolvedValueOnce({ activityId: '222' });
		const { setAttributes } = renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://strava.app.link/abcd'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		await waitFor(() => {
			expect(setAttributes).toHaveBeenCalledWith({
				url: 'https://strava.app.link/abcd',
				activityId: '222',
				embedType: 'activity',
			});
		});
	});

	it('shows an Error instance message when the REST request fails', async () => {
		const user = userEvent.setup();
		mockedApiFetch.mockRejectedValueOnce(new Error('Activity not found'));
		renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://strava.app.link/xyz'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(
			await screen.findByText('Activity not found')
		).toBeInTheDocument();
	});

	it('falls back to a generic error string when the rejection is not an Error', async () => {
		const user = userEvent.setup();
		mockedApiFetch.mockRejectedValueOnce('boom');
		renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://strava.app.link/abc'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(
			await screen.findByText('Could not resolve URL.')
		).toBeInTheDocument();
	});

	it('shows a loading spinner while apiFetch is in flight', async () => {
		const user = userEvent.setup();
		let resolve!: (value: {
			activityId: string;
			embedType?: EmbedType;
		}) => void;
		mockedApiFetch.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolve = res;
				})
		);
		renderEdit();

		await user.type(
			screen.getByPlaceholderText('https://www.strava.com/activities/…'),
			'https://strava.app.link/spin'
		);
		await user.click(screen.getByRole('button', { name: 'Embed' }));

		expect(screen.getByTestId('spinner')).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Embed' })
		).not.toBeInTheDocument();
		expect(
			screen.getByTestId('placeholder').querySelector('form')
		).toHaveAttribute('aria-busy', 'true');

		await act(async () => {
			resolve({ activityId: '444', embedType: 'activity' });
		});
		await waitFor(() => {
			expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
		});
	});
});

describe('Edit – preview (rendered) mode', () => {
	it('renders a sandboxed iframe with the embed snippet for the activity', () => {
		const { container } = renderEdit({ activityId: '42' });
		const iframe = getIframe(container);
		expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
		const srcDoc = iframe.getAttribute('srcdoc') ?? '';
		expect(srcDoc).toContain('data-embed-id="42"');
	});

	it('wires the BROADCAST_IFRAME_HEIGHT relay and default-height fallback into the srcdoc', () => {
		const { container } = renderEdit({ activityId: '42' });
		const srcDoc = getIframe(container).getAttribute('srcdoc') ?? '';
		/*
		 * If these literals drift, Strava's embed.js never sees the relay and
		 * the editor preview never resizes — but no other unit test would
		 * notice. The DEFAULT_HEIGHT (730) is the fallback the relay sends
		 * when the embed reports no explicit height.
		 */
		expect(srcDoc).toContain('BROADCAST_IFRAME_HEIGHT');
		expect(srcDoc).toContain('||730');
	});

	it('renders the caption RichText only when the block is selected or the caption has content', () => {
		const unselectedNoCaption = renderEdit({ activityId: '42' });
		expect(
			unselectedNoCaption.queryByTestId('rich-text')
		).not.toBeInTheDocument();
		unselectedNoCaption.unmount();

		const selectedNoCaption = renderEdit({
			activityId: '42',
			isSelected: true,
		});
		expect(selectedNoCaption.getByTestId('rich-text')).toBeInTheDocument();
		selectedNoCaption.unmount();

		const unselectedWithCaption = renderEdit({
			activityId: '42',
			caption: 'Morning ride',
		});
		expect(
			unselectedWithCaption.getByTestId('rich-text')
		).toBeInTheDocument();
	});

	it('updates the caption attribute when the RichText fires onChange', () => {
		const { setAttributes } = renderEdit({
			activityId: '42',
			isSelected: true,
		});
		const rich = screen.getByTestId('rich-text');
		// Simulate an input event with the new text content.
		rich.textContent = 'Updated caption';
		fireEvent.input(rich);
		expect(setAttributes).toHaveBeenCalledWith({
			caption: 'Updated caption',
		});
	});

	it('switches back to editing mode when the Replace toolbar button is clicked', async () => {
		const user = userEvent.setup();
		const { container } = renderEdit({ activityId: '42' });
		expect(getIframe(container)).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Replace' }));
		expect(screen.getByTestId('placeholder')).toBeInTheDocument();
	});

	describe('postMessage height relay', () => {
		function dispatchMessage(source: Window | null, data: unknown): void {
			act(() => {
				window.dispatchEvent(
					new MessageEvent('message', {
						data,
						source: source as MessageEventSource | null,
					})
				);
			});
		}

		it('ignores messages from other windows', () => {
			const { container } = renderEdit({ activityId: '42' });
			const iframe = getIframe(container);
			const initialHeight = iframe.style.height;

			dispatchMessage(window, {
				stravaEmbedId: 'whatever',
				stravaEmbedHeight: 1234,
			});

			expect(iframe.style.height).toBe(initialHeight);
		});

		it('ignores messages with falsy data', () => {
			const { container } = renderEdit({ activityId: '42' });
			const iframe = getIframe(container);
			const before = iframe.style.height;
			dispatchMessage(iframe.contentWindow, null);
			expect(iframe.style.height).toBe(before);
		});

		it('ignores messages whose payload is not an object', () => {
			const { container } = renderEdit({ activityId: '42' });
			const iframe = getIframe(container);
			const before = iframe.style.height;
			dispatchMessage(iframe.contentWindow, 'not-an-object');
			expect(iframe.style.height).toBe(before);
		});

		it('ignores messages from this iframe with a mismatched embed id', () => {
			const { container } = renderEdit({ activityId: '42' });
			const iframe = getIframe(container);
			const before = iframe.style.height;
			dispatchMessage(iframe.contentWindow, {
				stravaEmbedId: 'mismatched',
				stravaEmbedHeight: 900,
			});
			expect(iframe.style.height).toBe(before);
		});

		it('ignores messages whose height is not finite', () => {
			const { container } = renderEdit({ activityId: '42' });
			const iframe = getIframe(container);
			const before = iframe.style.height;
			/* Use the real embedId so the non-finite check is the only branch left to fail. */
			dispatchMessage(iframe.contentWindow, {
				stravaEmbedId: extractEmbedId(iframe),
				stravaEmbedHeight: 'tall',
			});
			expect(iframe.style.height).toBe(before);
		});

		it('sets the iframe height when a valid relay message arrives', () => {
			const { container } = renderEdit({ activityId: '42' });
			const iframe = getIframe(container);
			const embedId = extractEmbedId(iframe);

			dispatchMessage(iframe.contentWindow, {
				stravaEmbedId: embedId,
				stravaEmbedHeight: 850,
			});

			expect(iframe.style.height).toBe('850px');
		});

		it('clamps heights below the minimum to the floor', () => {
			const { container } = renderEdit({ activityId: '42' });
			const iframe = getIframe(container);
			const embedId = extractEmbedId(iframe);

			dispatchMessage(iframe.contentWindow, {
				stravaEmbedId: embedId,
				stravaEmbedHeight: 50,
			});

			expect(iframe.style.height).toBe('100px');
		});

		it('clamps heights above the maximum to the ceiling', () => {
			const { container } = renderEdit({ activityId: '42' });
			const iframe = getIframe(container);
			const embedId = extractEmbedId(iframe);

			dispatchMessage(iframe.contentWindow, {
				stravaEmbedId: embedId,
				stravaEmbedHeight: 99999,
			});

			expect(iframe.style.height).toBe('5000px');
		});

		it('resets the height to the default when the activity changes', () => {
			const setAttributes = jest.fn();
			const { container, rerender } = render(
				<Edit
					attributes={{
						url: '',
						activityId: '42',
						embedType: 'activity',
						caption: '',
					}}
					setAttributes={setAttributes}
					isSelected={false}
				/>
			);
			const iframe = getIframe(container);
			const embedId = extractEmbedId(iframe);

			dispatchMessage(iframe.contentWindow, {
				stravaEmbedId: embedId,
				stravaEmbedHeight: 850,
			});
			expect(iframe.style.height).toBe('850px');

			rerender(
				<Edit
					attributes={{
						url: '',
						activityId: '99',
						embedType: 'activity',
						caption: '',
					}}
					setAttributes={setAttributes}
					isSelected={false}
				/>
			);

			expect(getIframe(container).style.height).toBe('730px');
		});
	});
});

describe('Edit – embedId generation', () => {
	const realCrypto = globalThis.crypto;

	afterEach(() => {
		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: realCrypto,
		});
	});

	it('uses crypto.randomUUID when the API is available', () => {
		const uuid = '00000000-0000-4000-8000-000000000000';
		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: { randomUUID: () => uuid },
		});

		const { container } = renderEdit({ activityId: '42' });
		const srcDoc =
			container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
		expect(srcDoc).toContain(`var n="${uuid}"`);
	});

	it('falls back to a random string id when crypto is unavailable', () => {
		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: undefined,
		});

		const { container } = renderEdit({ activityId: '42' });
		const srcDoc =
			container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
		expect(srcDoc).toMatch(/var n="bfs-[a-z0-9]+-[a-z0-9]+"/);
	});

	it('falls back when crypto exists but lacks randomUUID', () => {
		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: {},
		});

		const { container } = renderEdit({ activityId: '42' });
		const srcDoc =
			container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
		expect(srcDoc).toMatch(/var n="bfs-/);
	});
});
