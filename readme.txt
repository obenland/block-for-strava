=== Block for Strava ===
Contributors:      obenland
Tags:              strava, block, embed, activity, fitness
Requires at least: 6.0
Tested up to:      6.9
Requires PHP:      8.1
Stable tag:        1.0.0
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

Embed public Strava activities on your WordPress site with a simple block.

== Description ==

Block for Strava adds a Gutenberg block that lets you embed any public Strava activity on your site. Paste a Strava activity URL and the block renders the official Strava embed — no API keys required.

**Features:**

* Paste any public Strava activity URL
* Supports both full URLs (`strava.com/activities/…`) and short share links (`strava.app.link/…`)
* Choose between Standard and Large embed styles
* Live preview in the block editor
* No Strava account or API key needed

**Trademark Notice:** Strava is a trademark of Strava Inc. This plugin is not affiliated with or endorsed by Strava Inc.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/block-for-strava/`, or install directly from the WordPress Plugins screen.
2. Activate the plugin.
3. In the block editor, search for "Strava Activity" and insert the block.
4. Paste a public Strava activity URL and click Embed.

== Frequently Asked Questions ==

= Does this work with private activities? =

No. Only public Strava activities can be embedded. Private or followers-only activities will not display.

= Do I need a Strava account? =

No account or API key is required. The block uses Strava's public embed feature.

= What URL formats are supported? =

Full activity URLs (`https://www.strava.com/activities/12345678`) and Strava short share links (`https://strava.app.link/…`).

== Changelog ==

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.0.0 =
Initial release.
