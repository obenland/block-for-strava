import './editor.scss';
import { useState, useCallback, useEffect, useRef } from '@wordpress/element';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	SelectControl,
	Placeholder,
	TextControl,
	Button,
	Spinner,
	Notice,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { ConnectWithStravaButton } from './strava-assets';

interface Attributes {
	url: string;
	activityId: string;
	style: string;
	token: string;
}

interface EditProps {
	attributes: Attributes;
	setAttributes: (attrs: Partial<Attributes>) => void;
}

interface Athlete {
	id: number;
	firstname: string;
	lastname: string;
	profile: string;
}

type Status =
	| { connected: false }
	| {
			connected: true;
			athlete: Athlete;
			scope: string;
			hasActivityScope: boolean;
	  };

interface Activity {
	id: string;
	name: string;
	type: string;
	distance: number;
	startDate: string;
	private: boolean;
}

interface ResolveResponse {
	activityId: string;
	token?: string;
}

interface AuthorizeUrlResponse {
	url: string;
}

interface ActivitiesResponse {
	activities: Activity[];
}

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

function formatDistance(meters: number): string {
	if (!meters) {
		return '';
	}
	const km = meters / 1000;
	return sprintf(
		/* translators: %s: distance in kilometers. */
		__('%s km', 'block-for-strava'),
		km.toFixed(2)
	);
}

function formatDate(value: string): string {
	if (!value) {
		return '';
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	/*
	 * The REST endpoint returns Strava's start_date_local, which is the UTC
	 * representation of the activity's local start time. Format in UTC so
	 * the displayed date matches the athlete's actual local day rather than
	 * the editor's browser timezone.
	 */
	return date.toLocaleDateString(undefined, { timeZone: 'UTC' });
}

function StravaAttribution(): JSX.Element {
	return (
		<div className="block-for-strava__attribution">
			<span>{__('Powered by Strava', 'block-for-strava')}</span>
		</div>
	);
}

export default function Edit({ attributes, setAttributes }: EditProps) {
	const { activityId, style, token } = attributes;
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

	const [status, setStatus] = useState<Status | null>(null);
	const [statusLoading, setStatusLoading] = useState(true);
	const [activities, setActivities] = useState<Activity[] | null>(null);
	const [activitiesLoading, setActivitiesLoading] = useState(false);
	const [activitiesError, setActivitiesError] = useState<string | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	const popupRef = useRef<Window | null>(null);

	const fetchStatus = useCallback(async () => {
		setStatusLoading(true);
		try {
			const result = await apiFetch<Status>({
				path: '/block-for-strava/v1/oauth/status',
			});
			setStatus(result);
		} catch {
			setStatus({ connected: false });
		} finally {
			setStatusLoading(false);
		}
	}, []);

	const fetchActivities = useCallback(async () => {
		setActivitiesLoading(true);
		setActivitiesError(null);
		try {
			const result = await apiFetch<ActivitiesResponse>({
				path: '/block-for-strava/v1/activities?per_page=10',
			});
			setActivities(result.activities);
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: __('Could not load activities.', 'block-for-strava');
			setActivitiesError(message);
		} finally {
			setActivitiesLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchStatus();
	}, [fetchStatus]);

	useEffect(() => {
		if (status?.connected && isEditing) {
			void fetchActivities();
		}
	}, [status, isEditing, fetchActivities]);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) {
				return;
			}
			const data = event.data as
				| { type?: string; status?: string; message?: string }
				| undefined;
			if (!data || data.type !== 'block-for-strava-oauth') {
				return;
			}
			setIsConnecting(false);
			if (data.status === 'success') {
				void fetchStatus();
			} else if (data.message) {
				setError(data.message);
			}
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [fetchStatus]);

	const handleConnect = useCallback(async () => {
		setError(null);
		setIsConnecting(true);
		try {
			const response = await apiFetch<AuthorizeUrlResponse>({
				path: '/block-for-strava/v1/oauth/authorize-url',
			});
			const features = 'width=600,height=700,menubar=no,toolbar=no';
			popupRef.current = window.open(
				response.url,
				'block-for-strava-oauth',
				features
			);
			if (!popupRef.current) {
				setIsConnecting(false);
				setError(
					__(
						'Could not open the Strava authorization window. Please allow popups and try again.',
						'block-for-strava'
					)
				);
			}
		} catch (err) {
			setIsConnecting(false);
			const message =
				err instanceof Error
					? err.message
					: __(
							'Could not start Strava authorization.',
							'block-for-strava'
						);
			setError(message);
		}
	}, []);

	const handleDisconnect = useCallback(async () => {
		try {
			await apiFetch({
				path: '/block-for-strava/v1/oauth/disconnect',
				method: 'DELETE',
			});
		} catch {
			// Ignore errors - we'll just refetch status.
		}
		setActivities(null);
		await fetchStatus();
	}, [fetchStatus]);

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

		if (parseActivityId(trimmed) || isShortUrl(trimmed)) {
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

	const handlePickActivity = useCallback(
		(activity: Activity) => {
			setAttributes({
				url: `https://www.strava.com/activities/${activity.id}`,
				activityId: activity.id,
				token: '',
			});
			setIsEditing(false);
		},
		[setAttributes]
	);

	const tokenAttr = token ? ` data-token="${token}"` : '';
	const iframeSrcDoc = `<!DOCTYPE html><html><head><style>body{margin:0;}</style></head><body><div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="${activityId}" data-style="${style}"${tokenAttr}></div><script src="https://strava-embeds.com/embed.js"></script><script>window.addEventListener('message',function(e){if(Array.isArray(e.data)&&e.data[1]==='BROADCAST_IFRAME_HEIGHT'){window.parent.postMessage({stravaEmbedHeight:e.data[2]||650},'*');}});</script></body></html>`;

	const athleteName =
		status?.connected && status.athlete
			? `${status.athlete.firstname} ${status.athlete.lastname}`.trim()
			: '';

	let accountPanel;
	if (statusLoading) {
		accountPanel = <Spinner />;
	} else if (status?.connected) {
		accountPanel = (
			<>
				<p className="block-for-strava__account">
					{sprintf(
						/* translators: %s: athlete name. */
						__('Connected as %s', 'block-for-strava'),
						athleteName || __('Strava user', 'block-for-strava')
					)}
				</p>
				<Button
					variant="secondary"
					onClick={() => void handleDisconnect()}
				>
					{__('Disconnect', 'block-for-strava')}
				</Button>
				<StravaAttribution />
			</>
		);
	} else {
		accountPanel = (
			<ConnectWithStravaButton
				onClick={() => void handleConnect()}
				disabled={isConnecting}
			/>
		);
	}

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
				<PanelBody title={__('Strava Account', 'block-for-strava')}>
					{accountPanel}
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				{isEditing ? (
					<Placeholder
						icon="chart-area"
						label={__('Strava Activity', 'block-for-strava')}
						instructions={
							status?.connected
								? __(
										'Pick one of your recent activities, or paste a Strava activity URL or embed code.',
										'block-for-strava'
									)
								: __(
										'Connect your Strava account to pick an activity, or paste a Strava activity URL or embed code.',
										'block-for-strava'
									)
						}
					>
						<div className="block-for-strava__placeholder">
							{statusLoading && <Spinner />}

							{!statusLoading && !status?.connected && (
								<div className="block-for-strava__connect">
									<ConnectWithStravaButton
										onClick={() => void handleConnect()}
										disabled={isConnecting}
									/>
								</div>
							)}

							{!statusLoading &&
								status?.connected &&
								status.hasActivityScope === false && (
									<Notice
										status="warning"
										isDismissible={false}
									>
										{__(
											'Activity access was not granted. Disconnect and reconnect, granting all requested permissions to see your activities here.',
											'block-for-strava'
										)}
									</Notice>
								)}

							{!statusLoading &&
								status?.connected &&
								status.hasActivityScope !== false && (
									<div className="block-for-strava__activities">
										{activitiesLoading && <Spinner />}
										{activitiesError && (
											<Notice
												status="error"
												isDismissible={false}
											>
												{activitiesError}
											</Notice>
										)}
										{activities &&
											activities.length === 0 && (
												<p>
													{__(
														'No activities found on this account.',
														'block-for-strava'
													)}
												</p>
											)}
										{activities &&
											activities.length > 0 && (
												<ul className="block-for-strava__activity-list">
													{activities.map(
														(activity) => (
															<li
																key={
																	activity.id
																}
																className="block-for-strava__activity"
															>
																<button
																	type="button"
																	className="block-for-strava__activity-button"
																	onClick={() =>
																		handlePickActivity(
																			activity
																		)
																	}
																	title={
																		activity.private
																			? __(
																					'Private activities will not render in the public embed.',
																					'block-for-strava'
																				)
																			: undefined
																	}
																>
																	<span className="block-for-strava__activity-name">
																		{
																			activity.name
																		}
																		{activity.private && (
																			<span className="block-for-strava__activity-badge">
																				{__(
																					'Private',
																					'block-for-strava'
																				)}
																			</span>
																		)}
																	</span>
																	<span className="block-for-strava__activity-meta">
																		{[
																			activity.type,
																			formatDistance(
																				activity.distance
																			),
																			formatDate(
																				activity.startDate
																			),
																		]
																			.filter(
																				Boolean
																			)
																			.join(
																				' · '
																			)}
																	</span>
																</button>
															</li>
														)
													)}
												</ul>
											)}
										{activities &&
											activities.length > 0 && (
												<StravaAttribution />
											)}
									</div>
								)}

							<details
								className="block-for-strava__url-fallback"
								open={!status?.connected}
							>
								<summary>
									{__(
										'Or paste an activity URL or embed code',
										'block-for-strava'
									)}
								</summary>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										void handleSubmit();
									}}
								>
									<TextControl
										label={__(
											'Activity URL',
											'block-for-strava'
										)}
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
								</form>
							</details>

							{error && (
								<p className="block-for-strava__error">
									{error}
								</p>
							)}
						</div>
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
