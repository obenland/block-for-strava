# Block for Strava — Design Spec

**Date:** 2026-04-23  
**Status:** Approved

## Overview

A WordPress Gutenberg block plugin that accepts a public Strava activity URL and renders the official Strava embed. Submitted to the WordPress.org plugin directory.

## Constraints

- Public activities only (no OAuth/Strava API key required)
- No oEmbed (Strava has no oEmbed endpoint)
- TypeScript + `@wordpress/scripts` build
- Node 24, PHP 7.4+, WordPress 6.0+
- WordPress coding standards, plugin directory guidelines
- "Block for Strava" — not affiliated with or endorsed by Strava Inc.

## Architecture

Single dynamic block `obenland/strava-activity` registered via `block.json`. PHP render callback generates the embed HTML at request time. No frontend JS from the plugin — the embed is driven entirely by `strava-embeds.com/embed.js`, enqueued once per page via `wp_enqueue_script()` inside the render callback.

One small REST endpoint (`block-for-strava/v1/resolve`) handles short URL resolution server-side (CORS prevents browser redirect-following). The editor calls it only for `strava.app.link` short URLs; canonical `strava.com/activities/{id}` URLs are parsed in TypeScript directly.

## Block Attributes

| Attribute    | Type   | Default    | Notes                          |
|--------------|--------|------------|--------------------------------|
| `url`        | string | `""`       | Raw URL as entered by user     |
| `activityId` | string | `""`       | Resolved canonical activity ID |
| `style`      | string | `standard` | Enum: `standard`, `large`      |

## URL Handling

**Canonical URLs** (`https://www.strava.com/activities/{id}[?...]`):
- Parsed in TypeScript with regex: `/strava\.com\/activities\/(\d+)/`
- No server round-trip needed

**Short URLs** (`https://strava.app.link/{code}`):
- Editor calls `GET /wp-json/block-for-strava/v1/resolve?url={url}`
- PHP follows redirects via `wp_remote_head()` (up to 5 hops)
- Extracts activity ID from final URL using same regex
- Returns `{ "activityId": "12345" }` or WP_Error (400/500)

## Editor UX

- Empty state: URL input with placeholder ("Paste Strava activity URL…"), matching core embed block style
- After valid URL: live preview in `<iframe srcDoc={…}>` containing the actual embed.js — real Strava embed renders in editor
- Style change: iframe re-keyed to force reload
- Inspector panel: Style toggle (Standard / Large), "Replace URL" link
- Short URL / unresolvable URL: inline error below input

### Editor preview height: postMessage relay vs CSS aspect ratio

Core embed blocks reserve space for an embed using CSS `padding-bottom` percentages and `wp-embed-aspect-{16-9, 4-3, …}` classes (see `packages/block-library/src/embed/util.js#getClassNames`). That works because YouTube/Vimeo/etc have predictable, documented aspect ratios.

Strava embeds don't. An activity with a map, photos, and stats is much taller than a tokenless segment summary; vertical/horizontal layouts vary by content. There is no single ratio that fits, so we **deliberately do not adopt** the core aspect-ratio classes.

Instead, the editor preview uses a postMessage height-relay:

1. The iframe `srcDoc` includes a tiny script that listens for the embed's internal `BROADCAST_IFRAME_HEIGHT` message and re-broadcasts `{ stravaEmbedId, stravaEmbedHeight }` to the parent window.
2. The React component listens for those messages, requires `event.source === iframeRef.current?.contentWindow` (defense against frame spoofing), checks the embedId matches, and sets the height — clamped to 100–5000px.
3. A fresh `embedId` (UUID or `bfs-…` fallback) is generated whenever `activityId` changes, so a stale id from a previous embed cannot be replayed.

The frontend doesn't need any of this — Strava's own `embed.js` replaces the placeholder div with a sized iframe at runtime. The relay is editor-only.

## PHP Render Callback

```php
function block_for_strava_render_block( array $attributes ): string {
    $activity_id = sanitize_text_field( $attributes['activityId'] ?? '' );
    if ( ! $activity_id ) {
        return '';
    }
    $style = 'large' === ( $attributes['style'] ?? '' ) ? 'large' : 'standard';

    wp_enqueue_script(
        'strava-embeds',
        'https://strava-embeds.com/embed.js',
        [],
        null,
        true
    );

    return sprintf(
        '<div %s><div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="%s" data-style="%s"></div></div>',
        get_block_wrapper_attributes(),
        esc_attr( $activity_id ),
        esc_attr( $style )
    );
}
```

## REST Endpoint

`GET /wp-json/block-for-strava/v1/resolve?url={url}`

- No authentication required (public endpoint, read-only)
- Validates URL scheme and host before making outbound request
- Returns 400 for non-Strava URLs, 500 for network failures
- Response: `{ "activityId": "12345" }`

## File Structure

```
block-for-strava/
├── .github/workflows/
│   ├── deploy.yml          # tag → wordpress.org
│   ├── phpunit.yml         # PHP 7.4+8.4 × WP latest/trunk
│   ├── test-e2e.yml        # Playwright
│   └── wpcs.yml            # PHPCS + JS lint
├── src/
│   ├── block.json
│   ├── index.tsx
│   ├── edit.tsx
│   ├── save.tsx
│   ├── style.scss
│   └── editor.scss
├── build/                  # gitignored
├── includes/
│   ├── class-block-for-strava.php
│   └── functions.php
├── tests/
│   ├── bootstrap.php
│   ├── test-functions.php
│   └── test-rest.php
├── tests/e2e/
│   └── block.spec.ts
├── .distignore
├── .editorconfig
├── .gitignore
├── .nvmrc
├── .wp-env.json
├── block-for-strava.php
├── composer.json
├── package.json
├── phpcs.xml.dist
├── phpunit.xml
├── playwright.config.ts
├── readme.txt
└── tsconfig.json
```

## Naming Conventions

- Plugin slug: `block-for-strava`
- Text domain: `block-for-strava`
- PHP function prefix: `block_for_strava_`
- PHP class: `Block_For_Strava`
- PHP constants: `BLOCK_FOR_STRAVA_*`
- Block name: `obenland/strava-activity`

## Tests

**PHPUnit:**
- `parse_strava_activity_id()`: canonical URL with/without query args, short URL returns false, invalid URL returns false
- `resolve_strava_url()`: mocked `wp_remote_head()` returns redirect to canonical URL → extracts ID
- Render callback: correct HTML for standard/large styles, empty string for missing activityId
- REST endpoint: valid URL → 200 + activityId; non-Strava URL → 400; unresolvable → 400

**Playwright e2e:**
- Insert block, paste canonical URL, verify iframe preview appears
- Change style, verify `data-style` attribute updates
- Verify frontend render contains `.strava-embed-placeholder` with correct `data-embed-id`

## Plugin Directory

- License: GPL-2.0-or-later
- `readme.txt` includes trademark disclaimer: "Strava is a trademark of Strava Inc. This plugin is not affiliated with or endorsed by Strava Inc."
- `.distignore` excludes: `src/`, `tests/`, `node_modules/`, `vendor/`, `docs/`, `.github/`, config files
- Deploy via `10up/action-wordpress-plugin-deploy` on git tag
