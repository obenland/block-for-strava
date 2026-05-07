=== Block for Strava ===
Contributors:      obenland
Tags:              strava, block, embed, activity, fitness
Requires at least: 6.6
Tested up to:      6.9
Requires PHP:      8.1
Stable tag:        1.0.0
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

Add your Strava activities, routes, and segments to any post or page with a single block.

== Description ==

Block for Strava lets you share your Strava activities, routes, and segments on your WordPress site. Paste a link from Strava and the official Strava embed appears in your post — interactive map, elevation profile, stats, and all.

There's nothing to set up. No accounts to connect, no keys to copy, no extra software. If you can paste a link, you can use this plugin.

**What you can do:**

* Paste a Strava link and turn it into a rich, interactive embed
* Embed any public activity, route, or segment — and your own private activities too (see the FAQ)
* Customize how routes look: map style, terrain, units, full-width display, dirt-surface highlighting, and an elevation toggle
* See exactly what your readers will see, right in the editor as you make changes
* Already typed a Strava link inside a paragraph? Click the paragraph and use the block toolbar's "Transform to" menu to swap it for a Strava block

**A note about private activities:** If your Strava activity is set to "Followers" or "Only You", open it on Strava, click Share → Embed, and copy the embed code Strava gives you. Paste that on its own line in your post and the block takes care of the rest.

**Trademark Notice:** Strava is a trademark of Strava Inc. This plugin is not affiliated with or endorsed by Strava Inc.

== Installation ==

1. In your WordPress dashboard, go to **Plugins → Add New**, search for "Block for Strava", and click **Install**.
2. Activate the plugin.
3. Open any post or page in the editor. Click the "+" button to add a block, search for "Strava", and select it.
4. Paste your Strava link into the block. For routes, use the settings panel on the right side of the editor to fine-tune how it looks.

Tip: You can also paste a Strava link onto its own line in a post — the editor will recognize it and turn it into a Strava block for you automatically.

== Frequently Asked Questions ==

= Do my visitors need a Strava account? =

No. Visitors just see the embed when they view your post — no login, no account, nothing extra. You also don't need a Strava account to embed public activities. The only time you'll need to be logged in to Strava is if you want to embed one of your own private activities, since you'll need to grab the embed code from Strava's share dialog.

= Can I embed private activities? =

Yes, with one extra step. For activities you've set to "Followers" or "Only You":

1. Open the activity on Strava (while logged in).
2. Click **Share → Embed**.
3. Copy the code Strava shows you.
4. Paste it on its own line in your post.

The block recognizes the code and handles everything from there. (At the moment, Strava only offers this option for activities — not for private routes or segments.)

= What kinds of Strava links work? =

Any of these:

* The full link to an activity, route, or segment (the URL you see at the top of the page on Strava)
* Strava short links (the kind that start with strava.app.link)
* The embed code from Strava's **Share → Embed** dialog (this is what you'll use for private activities)

= How do I change the look of an embedded route? =

Click the Strava block in the editor, and a settings panel appears on the right side of your screen. There you can pick the map style, switch between miles and kilometers, toggle the elevation profile, highlight dirt sections, and more. These options apply to routes; activities and segments use Strava's standard look.

= Will this slow down my site or share visitor data? =

The Strava embed loads directly from Strava when someone views your page — much like a YouTube video does. The full details of what gets sent to Strava are in the **External services** section below.

== External services ==

This plugin uses Strava's public embed feature to display your content.

**When someone views a page with a Strava block,** their browser loads the embed directly from `https://strava-embeds.com/`. As part of that, Strava may receive normal request information from the visitor — such as their IP address, browser type, your site's domain (not the full page URL), and the ID of the activity, route, or segment being shown.

**For private activities,** the embed code you paste from Strava includes a share code. That share code is what tells Strava it's allowed to display the activity, and it's sent to Strava every time the embed loads.

**For Strava short links** (the kind that start with `https://strava.app.link/`), your site asks Strava what the full link is and remembers the answer for up to a day, so the same link doesn't trigger a fresh lookup on every visit. After that the check happens again. These checks only go to `strava.app.link` or `strava.com`.

**External service:** Strava public embeds (`strava-embeds.com`, `strava.app.link`, `strava.com`), operated by Strava, Inc. This plugin is independently developed and is not affiliated with or endorsed by Strava Inc.

* Terms of Service: [Strava Terms of Service](https://www.strava.com/legal/terms)
* Privacy Policy: [Strava Privacy Policy](https://www.strava.com/legal/privacy)

== Development ==

The plugin's source code is maintained on GitHub: [Block for Strava on GitHub](https://github.com/obenland/block-for-strava).

The version downloaded from WordPress.org is ready to use as-is. If you'd like to build the plugin from source, clone the repository and run:

1. `npm ci`
2. `npm run build`

== Screenshots ==

1. Embed a Strava activity with the full interactive map, stats, and an optional caption — the same view your visitors would get on Strava.
2. Routes embed with their elevation profile and let you switch between map styles like satellite, hybrid, dark, or winter, plus optional 3D terrain and unpaved-surface highlights.
3. Search "Strava" in the inserter — a live preview shows what your route will look like before you add it.
4. Tweak each route from the editor sidebar: map style, terrain, units, embed width, and toggles for the elevation profile and unpaved surfaces.
5. Add or remove a caption straight from the block toolbar — no extra panels to dig through.

== Changelog ==

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.0.0 =
Initial release.
