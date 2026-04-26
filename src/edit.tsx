import './editor.scss';
import {
	useState,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from '@wordpress/element';
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
	const iframeRef = useRef<HTMLIFrameElement>(null);

	/*
	 * Each iframe gets a unique embedId in its srcDoc, which the relay echoes
	 * in every postMessage. The React listener only acts on matching ids, so
	 * multiple Strava blocks on the same page never cross-update each other.
	 * Listing activityId/token as deps regenerates the id (and remounts the
	 * iframe) when the underlying activity changes; neither is read inside.
	 */
	const embedId = useMemo(() => crypto.randomUUID(), [activityId, token]);

	/*
	 * Each new iframe should start at the default height. Without this reset,
	 * a tall previous embed could leave the height stuck if the relay message
	 * for the new activity is delayed, blocked, or never arrives.
	 */
	useEffect(() => {
		setPreviewHeight(DEFAULT_HEIGHT);
	}, [embedId]);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			/*
			 * Defense in depth: the embedId is a UUID and effectively
			 * unguessable, but also require the message to originate from
			 * this block's own iframe so other frames on the page cannot
			 * spoof height updates even if they obtain the id.
			 */
			if (event.source !== iframeRef.current?.contentWindow) {
				return;
			}
			const data = event.data;
			if (
				data &&
				typeof data === 'object' &&
				data.stravaEmbedId === embedId &&
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
	}, [embedId]);

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
	const iframeSrcDoc = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;}</style></head><body><div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="${activityId}" data-style="standard"${tokenAttr}></div><script src="https://strava-embeds.com/embed.js"></script><script>(function(){var n="${embedId}";function send(h){window.parent.postMessage({stravaEmbedId:n,stravaEmbedHeight:h},"*");}window.addEventListener("message",function(e){if(Array.isArray(e.data)&&e.data[1]==="BROADCAST_IFRAME_HEIGHT"){send(e.data[2]||${DEFAULT_HEIGHT});}});})();</script></body></html>`;

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
							key={embedId}
							ref={iframeRef}
							srcDoc={iframeSrcDoc}
							style={{
								width: '100%',
								height: `${previewHeight}px`,
								border: 'none',
								display: 'block',
							}}
							scrolling="no"
							/*
							 * Sandbox isolates Strava's third-party embed.js:
							 * scripts run in an opaque origin, so they cannot
							 * reach wp-admin cookies/storage or navigate the
							 * top frame. postMessage works from sandboxed
							 * frames, so the height relay is unaffected.
							 */
							sandbox="allow-scripts"
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
