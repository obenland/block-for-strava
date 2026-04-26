import './editor.scss';
import { useState, useCallback, useEffect, useMemo } from '@wordpress/element';
import {
	useBlockProps,
	BlockControls,
	BlockIcon,
	RichText,
} from '@wordpress/block-editor';
import {
	Placeholder,
	TextControl,
	Button,
	Spinner,
	Disabled,
	ToolbarGroup,
	ToolbarButton,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	pencil as pencilIcon,
	chartBar as activityIcon,
} from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';

interface Attributes {
	url: string;
	activityId: string;
	token: string;
	caption: string;
}

interface EditProps {
	attributes: Attributes;
	setAttributes: (attrs: Partial<Attributes>) => void;
	isSelected: boolean;
}

interface ResolveResponse {
	activityId: string;
	token?: string;
}

const DEFAULT_HEIGHT = 730;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 5000;

function parseActivityId(url: string): string | null {
	const match = url.match(/strava\.com\/activities\/(\d+)/i);
	return match ? match[1] : null;
}

function parseEmbedCode(
	input: string
): { activityId: string; token: string } | null {
	const idMatch = input.match(/data-embed-id="(\d+)"/);
	if (!idMatch) {
		return null;
	}
	const tokenMatch = input.match(/data-token="([^"]+)"/);
	return { activityId: idMatch[1], token: tokenMatch ? tokenMatch[1] : '' };
}

function isShortUrl(url: string): boolean {
	return /strava\.app\.link/i.test(url);
}

export default function Edit({
	attributes,
	setAttributes,
	isSelected,
}: EditProps) {
	const { activityId, token, caption } = attributes;
	const blockProps = useBlockProps();

	const [inputUrl, setInputUrl] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isEditing, setIsEditing] = useState(!activityId);
	const [previewHeight, setPreviewHeight] = useState(DEFAULT_HEIGHT);

	/*
	 * Each render of the iframe gets a unique nonce embedded in its srcDoc. The
	 * srcDoc relay includes that nonce in every postMessage, so the React
	 * listener only reacts to messages from this block's own iframe.
	 */
	/*
	 * Listing activityId/token as deps regenerates the nonce (and forces an
	 * iframe remount) whenever the underlying activity changes, even though
	 * neither value is read inside the factory.
	 */
	const nonce = useMemo(
		() => `bfs_${Math.random().toString(36).slice(2)}`,
		[activityId, token]
	);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const data = event.data;
			if (
				data &&
				typeof data === 'object' &&
				data.stravaEmbedNonce === nonce &&
				Number.isFinite(data.stravaEmbedHeight)
			) {
				const next = Math.min(
					Math.max(data.stravaEmbedHeight, MIN_HEIGHT),
					MAX_HEIGHT
				);
				setPreviewHeight(next);
			}
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [nonce]);

	const handleSubmit = useCallback(async () => {
		setError(null);
		const trimmed = inputUrl.trim();

		if (!trimmed) {
			setError(__('Please enter a URL.', 'block-for-strava'));
			return;
		}

		const embedData = parseEmbedCode(trimmed);
		if (embedData) {
			setAttributes({
				url: trimmed,
				activityId: embedData.activityId,
				token: embedData.token,
			});
			setIsEditing(false);
			return;
		}

		const parsed = parseActivityId(trimmed);
		if (parsed || isShortUrl(trimmed)) {
			setIsLoading(true);
			try {
				const response = await apiFetch<ResolveResponse>({
					path: `/block-for-strava/v1/resolve?url=${encodeURIComponent(trimmed)}`,
				});
				setAttributes({
					url: trimmed,
					activityId: response.activityId,
					token: response.token ?? '',
				});
				setIsEditing(false);
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: __('Could not resolve URL.', 'block-for-strava');
				setError(message);
			} finally {
				setIsLoading(false);
			}
			return;
		}

		setError(
			__(
				'Please enter a valid Strava activity URL (e.g. https://www.strava.com/activities/…).',
				'block-for-strava'
			)
		);
	}, [inputUrl, setAttributes]);

	const tokenAttr = token ? ` data-token="${token}"` : '';
	const iframeSrcDoc = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;}</style></head><body><div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="${activityId}" data-style="standard"${tokenAttr}></div><script src="https://strava-embeds.com/embed.js"></script><script>(function(){var n="${nonce}";function send(h){window.parent.postMessage({stravaEmbedNonce:n,stravaEmbedHeight:h},"*");}window.addEventListener("message",function(e){if(Array.isArray(e.data)&&e.data[1]==="BROADCAST_IFRAME_HEIGHT"){send(e.data[2]||${DEFAULT_HEIGHT});}});})();</script></body></html>`;

	return (
		<>
			{!isEditing && (
				<BlockControls>
					<ToolbarGroup>
						<ToolbarButton
							icon={pencilIcon}
							label={__('Replace', 'block-for-strava')}
							onClick={() => {
								setInputUrl('');
								setError(null);
								setIsEditing(true);
							}}
						/>
					</ToolbarGroup>
				</BlockControls>
			)}

			{isEditing ? (
				<div {...blockProps}>
					<Placeholder
						icon={<BlockIcon icon={activityIcon} showColors />}
						label={__('Strava Activity', 'block-for-strava')}
						instructions={__(
							'Paste a Strava activity URL or the embed code from the Strava share dialog.',
							'block-for-strava'
						)}
					>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								void handleSubmit();
							}}
						>
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								className="block-for-strava__url-input"
								label={__('Activity URL', 'block-for-strava')}
								hideLabelFromVision
								placeholder={__(
									'https://www.strava.com/activities/…',
									'block-for-strava'
								)}
								value={inputUrl}
								onChange={setInputUrl}
								disabled={isLoading}
							/>
							{isLoading ? (
								<Spinner />
							) : (
								<Button
									__next40pxDefaultSize
									variant="primary"
									type="submit"
								>
									{__('Embed', 'block-for-strava')}
								</Button>
							)}
						</form>
						{error && (
							<p className="block-for-strava__error">{error}</p>
						)}
					</Placeholder>
				</div>
			) : (
				<figure {...blockProps}>
					<Disabled>
						<iframe
							key={nonce}
							srcDoc={iframeSrcDoc}
							style={{
								width: '100%',
								height: `${previewHeight}px`,
								border: 'none',
								display: 'block',
							}}
							scrolling="no"
							title={__('Strava Activity', 'block-for-strava')}
						/>
					</Disabled>
					{(isSelected || caption) && (
						<RichText
							identifier="caption"
							tagName="figcaption"
							className="wp-element-caption"
							placeholder={__('Add caption', 'block-for-strava')}
							value={caption}
							onChange={(value: string) =>
								setAttributes({ caption: value })
							}
							inlineToolbar
						/>
					)}
				</figure>
			)}
		</>
	);
}
