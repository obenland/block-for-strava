=== Block for Strava ===
Contributors:      obenland
Tags:              strava, block, embed, activity, fitness
Requires at least: 6.6
Tested up to:      6.9
Requires PHP:      8.1
Stable tag:        1.0.0
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

A single Gutenberg block for embedding public Strava activities, routes, and segments on your WordPress site.

== Description ==

Block for Strava adds a single block to the editor that embeds any public Strava URL — paste an activity, route, or segment link and the block renders the official Strava embed inside a sandboxed iframe.

**Features:**

* One Gutenberg block — find "Strava" in the inserter, paste a URL, done
* Pasting a Strava URL or share-dialog snippet directly into post content auto-converts to the Strava block — no manual transform required
* Supports full URLs (`strava.com/activities/…`, `strava.com/routes/…`, `strava.com/segments/…`), short share links (`strava.app.link/…`), and the share-dialog embed snippet (with token, for non-public activities)
* Per-route options for map style, terrain, units, full-width, dirt-surface highlight, and elevation toggle
* Front-end pages render the official Strava embed (interactive map, elevation profile, etc.) inside a cross-origin sandboxed iframe with `referrerpolicy=origin`
* Live in-editor preview with route options applied
* No Strava account or API key needed

**Trademark Notice:** Strava is a trademark of Strava Inc. This plugin is not affiliated with or endorsed by Strava Inc.

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/block-for-strava/`, or install directly from the WordPress Plugins screen.
2. Activate the plugin.
3. In the block editor, open the inserter, search for "Strava", and pick the block. Or just paste a Strava URL onto its own line in the post — it auto-converts to a Strava block.
4. Paste any Strava activity, route, or segment URL into the placeholder. For routes, use the Inspector panel to tweak map style, terrain, units, and so on.

For non-public activities (visibility set to "Followers" or "Only You"), copy the embed snippet from Strava's share dialog (Share → Embed) and paste it on its own line — the Strava block picks up both the activity and the per-share token so the iframe loads.

== Frequently Asked Questions ==

= Does this work with private activities, routes, or segments? =

Public ("Everyone") resources embed from a URL alone. Followers-only and private activities require Strava's share-dialog snippet — paste the `<div class="strava-embed-placeholder" …>…</div>` block (with its `data-token` share token) on its own line and the Strava block picks it up. Strava only generates a share token if the activity owner has explicitly enabled sharing for that visibility level, so an activity with no share token cannot be embedded.

= Do I need a Strava account? =

No account or API key is required. The block uses Strava's public embed feature.

= What URL formats are supported? =

Full canonical URLs — `https://www.strava.com/activities/12345678`, `https://www.strava.com/routes/12345`, `https://www.strava.com/segments/67890` — and Strava short share links (`https://strava.app.link/…`). The share-dialog embed snippet (the `<div class="strava-embed-placeholder" …>…</div>` block from Strava's Share → Embed dialog) is also supported and is the path to use for non-public activities, since it carries the per-share token Strava requires for those embeds.

= Why does this plugin run server-side PHP? =

Strava does not publish a public oEmbed endpoint. The block's render callback (registered through `block.json`) generates the iframe markup deterministically from the saved URL and route attributes. There are no admin pages, options screens, REST endpoints, or scheduled tasks — the PHP runs only when a post containing the block is rendered.

== External services ==

This plugin embeds public Strava content through Strava's public embed service.
When a visitor views a post containing a Strava embed, their browser requests
the embed iframe from `https://strava-embeds.com/`. Strava may receive request
data such as the visitor's IP address, browser user agent, referring site
origin, and the Strava activity, route, or segment ID in the embed URL.

When a Strava short share link (`https://strava.app.link/…`) is embedded, the
site server makes a `HEAD` request to `strava.app.link` and follows redirects
only to `strava.app.link` or `strava.com` to resolve the public activity, route,
or segment URL. Resolved URLs are cached temporarily in WordPress transients.

External service: Strava public embeds, operated by Strava, Inc. This plugin is
independently developed and is not affiliated with or endorsed by Strava Inc.
Terms of Service: [Strava Terms of Service](https://www.strava.com/legal/terms)
Privacy Policy: [Strava Privacy Policy](https://www.strava.com/legal/privacy)

== Development ==

The human-readable source files and build tooling are maintained in the
[Block for Strava GitHub repository](https://github.com/obenland/block-for-strava).

The WordPress.org package includes the compiled `build/index.js` asset and the
`build/block.json` / `build/render.php` files that the block registers from. To
rebuild the assets from source, clone the repository and run:

1. `npm ci`
2. `npm run build`

The editor source files are in `src/`. PHP source is included in the plugin
package.

== Changelog ==

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.0.0 =
Initial release.
