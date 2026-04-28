import { createBlock } from '@wordpress/blocks';
import { escapeAttribute, escapeHTML } from '@wordpress/escape-html';

import metadata from './block.json';

interface StravaAttributes {
	url: string;
	activityId: string;
	token: string;
	caption: string;
}

const STRAVA_BLOCK = metadata.name;

const CANONICAL_URL_RE =
	/^https?:\/\/(?:www\.)?strava\.com\/activities\/(\d+)(?:[/?#].*)?$/i;
const SHORT_URL_RE = /^https?:\/\/strava\.app\.link\/[^\s]+$/i;
const SAFE_URL_RE = /^https?:\/\//i;

/**
 * Returns the activity id when the trimmed input is a canonical Strava
 * activity URL, an empty string for valid short links (the renderer resolves
 * those server-side), or null when the input is not a Strava activity URL.
 * @param input
 */
function matchStravaUrl(input: string): { activityId: string } | null {
	const canonical = input.match(CANONICAL_URL_RE);
	if (canonical) {
		return { activityId: canonical[1] };
	}
	if (SHORT_URL_RE.test(input)) {
		return { activityId: '' };
	}
	return null;
}

interface ParagraphAttributes {
	content?: string;
}

const transforms = {
	from: [
		{
			type: 'block' as const,
			blocks: ['core/paragraph'],
			isMatch: ({ content }: ParagraphAttributes) => {
				if (typeof content !== 'string') {
					return false;
				}
				const trimmed = content.trim();
				return matchStravaUrl(trimmed) !== null;
			},
			transform: ({ content }: ParagraphAttributes) => {
				const trimmed = (content ?? '').trim();
				const match = matchStravaUrl(trimmed);
				return createBlock(STRAVA_BLOCK, {
					url: trimmed,
					activityId: match ? match.activityId : '',
				});
			},
		},
	],
	to: [
		{
			type: 'block' as const,
			blocks: ['core/paragraph'],
			isMatch: ({ url }: StravaAttributes) => !!url,
			transform: ({ url, caption }: StravaAttributes) => {
				/*
				 * `url` is a user-controlled attribute. Only emit an anchor
				 * when the protocol is http(s); otherwise fall back to safe
				 * text so attributes like `javascript:` or quote-injecting
				 * values cannot escape into executable markup.
				 */
				const escapedText = escapeHTML(url);
				let value = SAFE_URL_RE.test(url)
					? `<a href="${escapeAttribute(url)}">${escapedText}</a>`
					: escapedText;
				if (caption && caption.trim()) {
					value += `<br />${escapeHTML(caption)}`;
				}
				return createBlock('core/paragraph', {
					content: value,
				});
			},
		},
	],
};

export default transforms;
