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
	caption: string;
}

interface EditProps {
	attributes: Attributes;
	setAttributes: (attrs: Partial<Attributes>) => void;
	isSelected: boolean;
}

interface ResolveResponse {
	activityId: string;
}

const DEFAULT_HEIGHT = 730;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 5000;

/*
 * crypto.randomUUID is available in all WP-supported browsers in secure
 * contexts, but fall back to a random string if it's missing so the Edit
 * component never throws at render time.
 */
function generateEmbedId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `bfs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parseActivityId(url: string): string | null {
	const match = url.match(/strava\.com\/activities\/(\d+)/i);
	return match ? match[1] : null;
}

function parseEmbedCode(input: string): string | null {
	const idMatch = input.match(/data-embed-id="(\d+)"/);
	return idMatch ? idMatch[1] : null;
}

function isShortUrl(url: string): boolean {
	return /strava\.app\.link/i.test(url);
}

export default function Edit({
	attributes,
	setAttributes,
	isSelected,
}: EditProps) {
	const { activityId, caption } = attributes;
	const blockProps = useBlockProps();

	const [inputUrl, setInputUrl] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isEditing, setIsEditing] = useState(!activityId);
	const [previewHeight, setPreviewHeight] = useState(DEFAULT_HEIGHT);
	const iframeRef = useRef<HTMLIFrameElement>(null);

	/*
	 * Match core block conventions (image, video, embed): when the caption
	 * RichText mounts and is still empty, move focus into it so the user can
	 * start typing immediately. Skip the focus once content exists so we
	 * don't steal focus on every re-render.
	 */
	const captionRef = useCallback(
		(node: HTMLElement | null) => {
			if (node && !caption) {
				node.focus();
			}
		},
		[caption]
	);

	/*
	 * The embedId must be unguessable so the postMessage handler can verify
	 * a height update came from this block's own iframe and not another
	 * frame on the page that happened to learn the id. Listing activityId
	 * as a dep — even though it isn't read inside the callback — forces a
	 * fresh random id (and a remount) whenever the activity changes, so a
	 * stale id from a previous embed can't be replayed against the new one.
	 */
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const embedId = useMemo(() => generateEmbedId(), [activityId]);

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

		const embedActivityId = parseEmbedCode(trimmed);
		if (embedActivityId) {
			setAttributes({ url: trimmed, activityId: embedActivityId });
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

	const iframeSrcDoc = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;}</style></head><body><div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="${activityId}" data-style="standard"></div><script src="https://strava-embeds.com/embed.js"></script><script>(function(){var n="${embedId}";function send(h){window.parent.postMessage({stravaEmbedId:n,stravaEmbedHeight:h},"*");}window.addEventListener("message",function(e){if(Array.isArray(e.data)&&e.data[1]==="BROADCAST_IFRAME_HEIGHT"){send(e.data[2]||${DEFAULT_HEIGHT});}});})();</script></body></html>`;

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
							ref={captionRef}
							aria-label={__(
								'Strava activity caption text',
								'block-for-strava'
							)}
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
