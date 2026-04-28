import { createBlock } from '@wordpress/blocks';
import transforms from '../../src/transforms';

const mockedCreateBlock = jest.mocked(createBlock);

interface FromTransform {
	type: 'block';
	blocks: string[];
	isMatch: (attrs: { content?: string }) => boolean;
	transform: (attrs: { content?: string }) => unknown;
}

interface ToTransform {
	type: 'block';
	blocks: string[];
	isMatch: (attrs: {
		url: string;
		activityId: string;
		token: string;
		caption: string;
	}) => boolean;
	transform: (attrs: {
		url: string;
		activityId: string;
		token: string;
		caption: string;
	}) => unknown;
}

const fromParagraph = transforms.from[0] as FromTransform;
const toParagraph = transforms.to[0] as ToTransform;

beforeEach(() => {
	mockedCreateBlock.mockClear();
});

describe('transforms.from paragraph → strava block', () => {
	it('matches a paragraph whose content is exactly a canonical Strava activity URL', () => {
		expect(
			fromParagraph.isMatch({
				content: 'https://www.strava.com/activities/123',
			})
		).toBe(true);
	});

	it('matches a paragraph whose content is exactly a strava.app.link short URL', () => {
		expect(
			fromParagraph.isMatch({ content: 'https://strava.app.link/abcd' })
		).toBe(true);
	});

	it('does not match plain text', () => {
		expect(fromParagraph.isMatch({ content: 'Just some words' })).toBe(
			false
		);
	});

	it('does not match a non-Strava URL', () => {
		expect(
			fromParagraph.isMatch({ content: 'https://example.com/x' })
		).toBe(false);
	});

	it('does not match when content is missing', () => {
		expect(fromParagraph.isMatch({})).toBe(false);
	});

	it('does not match when content is not a string', () => {
		expect(fromParagraph.isMatch({ content: undefined })).toBe(false);
	});

	it('extracts activityId from a canonical URL on transform', () => {
		fromParagraph.transform({
			content: '  https://www.strava.com/activities/456  ',
		});
		expect(mockedCreateBlock).toHaveBeenCalledWith(
			'obenland/strava-activity',
			{
				url: 'https://www.strava.com/activities/456',
				activityId: '456',
			}
		);
	});

	it('leaves activityId empty for short URLs (renderer resolves them)', () => {
		fromParagraph.transform({
			content: 'https://strava.app.link/xyz',
		});
		expect(mockedCreateBlock).toHaveBeenCalledWith(
			'obenland/strava-activity',
			{
				url: 'https://strava.app.link/xyz',
				activityId: '',
			}
		);
	});

	it('coerces missing content to empty string and leaves activityId empty', () => {
		fromParagraph.transform({});
		expect(mockedCreateBlock).toHaveBeenCalledWith(
			'obenland/strava-activity',
			{ url: '', activityId: '' }
		);
	});
});

describe('transforms.to strava block → paragraph (link fallback)', () => {
	const baseAttrs = {
		url: 'https://www.strava.com/activities/789',
		activityId: '789',
		token: '',
		caption: '',
	};

	it('matches when the block has a url', () => {
		expect(toParagraph.isMatch(baseAttrs)).toBe(true);
	});

	it('does not match when url is empty', () => {
		expect(toParagraph.isMatch({ ...baseAttrs, url: '' })).toBe(false);
	});

	it('produces a paragraph with a link to the URL', () => {
		toParagraph.transform(baseAttrs);
		expect(mockedCreateBlock).toHaveBeenCalledWith('core/paragraph', {
			content:
				'<a href="https://www.strava.com/activities/789">https://www.strava.com/activities/789</a>',
		});
	});

	it('appends the caption after a line break when present', () => {
		toParagraph.transform({ ...baseAttrs, caption: 'Morning ride' });
		expect(mockedCreateBlock).toHaveBeenCalledWith('core/paragraph', {
			content:
				'<a href="https://www.strava.com/activities/789">https://www.strava.com/activities/789</a><br />Morning ride',
		});
	});

	it('ignores whitespace-only captions', () => {
		toParagraph.transform({ ...baseAttrs, caption: '   ' });
		expect(mockedCreateBlock).toHaveBeenCalledWith('core/paragraph', {
			content:
				'<a href="https://www.strava.com/activities/789">https://www.strava.com/activities/789</a>',
		});
	});

	it('renders non-http(s) URLs as escaped text instead of a link', () => {
		toParagraph.transform({
			...baseAttrs,
			url: 'javascript:alert(1)',
		});
		expect(mockedCreateBlock).toHaveBeenCalledWith('core/paragraph', {
			content: 'javascript:alert(1)',
		});
	});

	it('escapes HTML-significant characters in the URL', () => {
		toParagraph.transform({
			...baseAttrs,
			url: 'https://www.strava.com/activities/789?x="><script>alert(1)</script>',
		});
		expect(mockedCreateBlock).toHaveBeenCalledWith('core/paragraph', {
			content:
				'<a href="https://www.strava.com/activities/789?x=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">https://www.strava.com/activities/789?x=">&lt;script>alert(1)&lt;/script></a>',
		});
	});

	it('escapes HTML-significant characters in the caption', () => {
		toParagraph.transform({
			...baseAttrs,
			caption: '<img src=x onerror=alert(1)>',
		});
		expect(mockedCreateBlock).toHaveBeenCalledWith('core/paragraph', {
			content:
				'<a href="https://www.strava.com/activities/789">https://www.strava.com/activities/789</a><br />&lt;img src=x onerror=alert(1)>',
		});
	});
});
