=== Block for Strava ===
Contributors:      obenland
Tags:              strava, block, embed, activity, fitness
Requires at least: 6.0
Tested up to:      6.9
Requires PHP:      8.1
Stable tag:        1.0.0
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

Embed public Strava activities, routes, and segments on your WordPress site with a simple block.

== Description ==

Block for Strava extends WordPress's core Embed block so any public Strava URL just works — paste the URL into a post and it converts into a Strava embed automatically. No new block type to learn, no API keys.

**Features:**

* Paste any public Strava activity, route, or segment URL on its own line — the editor turns it into an embed automatically
* Supports full URLs (`strava.com/activities/…`, `strava.com/routes/…`, `strava.com/segments/…`) and short share links (`strava.app.link/…`)
* Front-end pages render the official Strava embed (interactive map, elevation profile, etc.) inside a sandboxed iframe
* No Strava account or API key needed

**Trademark Notice:** Strava is a trademark of Strava Inc. This plugin is not affiliated with or endorsed by Strava Inc.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/block-for-strava/`, or install directly from the WordPress Plugins screen.
2. Activate the plugin.
3. In the block editor, paste any Strava activity, route, or segment URL onto its own line — it auto-converts to a Strava embed.
4. Or open the block inserter, search for "Strava", and pick the variation; then paste a URL into the embed block's prompt.

== Frequently Asked Questions ==

= Does this work with private activities, routes, or segments? =

No. Only public Strava activities, routes, and segments can be embedded. Private or followers-only resources will not display.

= Do I need a Strava account? =

No account or API key is required. The block uses Strava's public embed feature.

= What URL formats are supported? =

Full canonical URLs — `https://www.strava.com/activities/12345678`, `https://www.strava.com/routes/12345`, `https://www.strava.com/segments/67890` — and Strava short share links (`https://strava.app.link/…`).

== Changelog ==

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.0.0 =
Initial release.
