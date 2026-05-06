/**
 * Strava chevron icon as a React element.
 *
 * Mirrors the SVG path declared in `block.json` so the editor and the
 * WordPress.org Block Directory listing render the same mark. See the
 * comment in `index.tsx` for why the icon needs both a JSON string and a
 * React element form.
 */
const stravaIcon = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		<path d="M2 20 L8 9 L12 15 L18 5 L22 20 Z" />
	</svg>
);

export default stravaIcon;
