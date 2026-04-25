import './editor.scss';
import { useState, useCallback, useEffect } from '@wordpress/element';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	SelectControl,
	Placeholder,
	TextControl,
	Button,
	Spinner,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

interface Attributes {
	url: string;
	activityId: string;
	style: string;
}

interface EditProps {
	attributes: Attributes;
	setAttributes: (attrs: Partial<Attributes>) => void;
}

interface ResolveResponse {
	activityId: string;
}

function parseActivityId(url: string): string | null {
	const match = url.match(/strava\.com\/activities\/(\d+)/i);
	return match ? match[1] : null;
}

function isShortUrl(url: string): boolean {
	return /strava\.app\.link/i.test(url);
}

export default function Edit({ attributes, setAttributes }: EditProps) {
	const { activityId, style } = attributes;
	const blockProps = useBlockProps();

	const [inputUrl, setInputUrl] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isEditing, setIsEditing] = useState(!activityId);
	const [previewHeight, setPreviewHeight] = useState(650);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			if (
				event.data &&
				typeof event.data === 'object' &&
				typeof event.data.stravaEmbedHeight === 'number'
			) {
				setPreviewHeight(event.data.stravaEmbedHeight);
			}
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, []);

	useEffect(() => {
		setPreviewHeight(650);
	}, [activityId, style]);

	const handleSubmit = useCallback(async () => {
		setError(null);
		const trimmed = inputUrl.trim();

		if (!trimmed) {
			setError(__('Please enter a URL.', 'block-for-strava'));
			return;
		}

		const parsed = parseActivityId(trimmed);
		if (parsed) {
			setAttributes({ url: trimmed, activityId: parsed });
			setIsEditing(false);
			return;
		}

		if (isShortUrl(trimmed)) {
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

	const iframeSrcDoc = `<!DOCTYPE html><html><head><style>body{margin:0;}</style></head><body><div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="${activityId}" data-style="${style}"></div><script src="https://strava-embeds.com/embed.js"></script><script>window.addEventListener('message',function(e){if(Array.isArray(e.data)&&e.data[1]==='BROADCAST_IFRAME_HEIGHT'){window.parent.postMessage({stravaEmbedHeight:e.data[2]||650},'*');}});</script></body></html>`;

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Settings', 'block-for-strava')}>
					<SelectControl
						label={__('Style', 'block-for-strava')}
						value={style}
						options={[
							{
								label: __('Standard', 'block-for-strava'),
								value: 'standard',
							},
							{
								label: __('Large', 'block-for-strava'),
								value: 'large',
							},
						]}
						onChange={(value: string) =>
							setAttributes({ style: value })
						}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				{isEditing ? (
					<Placeholder
						icon="chart-area"
						label={__('Strava Activity', 'block-for-strava')}
						instructions={__(
							'Paste a public Strava activity URL to embed it.',
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
								<Button variant="primary" type="submit">
									{__('Embed', 'block-for-strava')}
								</Button>
							)}
							{error && (
								<p className="block-for-strava__error">
									{error}
								</p>
							)}
						</form>
					</Placeholder>
				) : (
					<>
						<div className="block-for-strava__toolbar">
							<Button
								variant="link"
								onClick={() => {
									setInputUrl('');
									setError(null);
									setIsEditing(true);
								}}
							>
								{__('Replace', 'block-for-strava')}
							</Button>
						</div>
						<iframe
							key={`${activityId}-${style}`}
							srcDoc={iframeSrcDoc}
							style={{
								width: '100%',
								height: `${previewHeight}px`,
								border: 'none',
								display: 'block',
							}}
							title={__('Strava Activity', 'block-for-strava')}
						/>
					</>
				)}
			</div>
		</>
	);
}
