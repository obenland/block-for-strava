=== Block for Strava ===
Contributors:      obenland
Tags:              strava, block, embed, activity, fitness
Requires at least: 6.0
Tested up to:      6.9
Requires PHP:      8.1
Stable tag:        1.1.0
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

Embed public Strava activities on your WordPress site with a simple block.

== Description ==

Block for Strava adds a Gutenberg block that lets you embed any public Strava activity on your site. Paste a Strava activity URL and the block renders the official Strava embed.

**Features:**

* Paste any public Strava activity URL
* Supports both full URLs (`strava.com/activities/…`) and short share links (`strava.app.link/…`)
* Choose between Standard and Large embed styles
* Live preview in the block editor
* Optional: connect your Strava account to pick from your own recent activities (including private ones) right in the editor

**Trademark Notice:** Strava is a trademark of Strava Inc. This plugin is not affiliated with or endorsed by Strava Inc.

== Privacy ==

Pasting a public Strava URL does not collect any personal data — the embed is rendered by Strava's own embed script.

If you choose to connect a Strava account ("Connect to Strava" in the block):

* You are redirected to Strava to authorize the connection. Strava returns an access token and refresh token to your WordPress site, which are stored in your WordPress user meta (only the user who connected can use them).
* The plugin uses a small OAuth proxy run by the plugin author to exchange the authorization code and refresh tokens. The proxy never sees your activities; it only handles the parts of the OAuth flow that require Strava's confidential client secret.
* Once connected, the editor calls the Strava API to list your recent activities so you can pick one. Activity data fetched via the API is shown only to you in the editor and is never displayed on your published posts; the public embed always uses Strava's official embed script.
* Click "Disconnect" in the block sidebar at any time to delete the stored tokens and athlete information from your site. If you revoke access on Strava's side, the plugin clears the stored tokens automatically the next time it sees a rejected request.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/block-for-strava/`, or install directly from the WordPress Plugins screen.
2. Activate the plugin.
3. In the block editor, search for "Strava Activity" and insert the block.
4. Paste a public Strava activity URL and click Embed.

== Frequently Asked Questions ==

= Does this work with private activities? =

No. Only public Strava activities can be embedded. Private or followers-only activities will not display.

= Do I need a Strava account? =

No. For pasting public activity URLs, no Strava account or API key is required. If you want the optional "pick from my activities" feature, click "Connect to Strava" in the block and authorize the plugin with your Strava account; no API key setup is needed on your side.

= What URL formats are supported? =

Full activity URLs (`https://www.strava.com/activities/12345678`) and Strava short share links (`https://strava.app.link/…`).

== Changelog ==

= 1.1.0 =
* Optional: connect a Strava account to pick activities from a list inside the editor (uses an OAuth proxy hosted by the plugin author; no API keys required on your site).
* Support pasting the full Strava embed code so unlisted/restricted activities render correctly via the embed's `data-token`.
* Relay the Strava embed's height to the editor preview iframe so the preview no longer clips.

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.1.0 =
Adds optional Strava account connection for picking activities from a list. Existing URL-based embeds continue to work unchanged.

= 1.0.0 =
Initial release.
