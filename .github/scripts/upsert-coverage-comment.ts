#!/usr/bin/env node
/**
 * Compose a single "Test Coverage Report" PR comment from multiple jobs.
 *
 * Each language has its own GitHub Actions workflow (JS, PHP). Both call
 * this script with their own SECTION; the script finds any existing report
 * comment, replaces just that section between marker comments, and posts
 * the merged body back. If no comment exists yet, it's created with a
 * placeholder for the other section so the layout stays stable.
 *
 * Inputs (env):
 *   SECTION       — "js" | "php"
 *   SECTION_TITLE — heading for this section (e.g. "JavaScript")
 *   CONTENT_FILE  — path to a markdown file with the new section body
 *   PR_NUMBER     — pull request number
 *   GH_TOKEN      — token used by the gh CLI
 *   GITHUB_REPOSITORY — owner/repo
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

type Section = 'js' | 'php';

interface IssueComment {
	id: number;
	user: { login: string } | null;
	body?: string;
}

const env = ( name: string ): string => {
	const value = process.env[ name ];
	if ( ! value ) {
		throw new Error( `Missing required env var: ${ name }` );
	}
	return value;
};

const TITLE = '## Test Coverage Report';
const SECTIONS: readonly Section[] = [ 'js', 'php' ] as const;
const TITLES: Record< Section, string > = { js: 'JavaScript', php: 'PHP' };
const startMarker = ( s: Section ): string => `<!-- coverage-${ s }-start -->`;
const endMarker = ( s: Section ): string => `<!-- coverage-${ s }-end -->`;

const buildSection = (
	section: Section,
	title: string,
	content: string
): string =>
	`${ startMarker( section ) }\n### ${ title }\n\n${ content }\n${ endMarker(
		section
	) }`;

const placeholder = ( section: Section ): string =>
	buildSection(
		section,
		TITLES[ section ],
		`_${ TITLES[ section ] } coverage not yet computed for this PR._`
	);

const sectionInput = env( 'SECTION' );
if ( ! ( SECTIONS as readonly string[] ).includes( sectionInput ) ) {
	throw new Error( `SECTION must be one of: ${ SECTIONS.join( ', ' ) }` );
}
const section = sectionInput as Section;
const sectionTitle = env( 'SECTION_TITLE' );
const contentFile = env( 'CONTENT_FILE' );
const prNumber = env( 'PR_NUMBER' );
const repo = env( 'GITHUB_REPOSITORY' );
/* Validate eagerly so a missing token surfaces here rather than as an opaque gh-CLI error mid-run. */
env( 'GH_TOKEN' );

const newContent = readFileSync( contentFile, 'utf8' ).trim();
if ( ! newContent ) {
	throw new Error( `Coverage content file is empty: ${ contentFile }` );
}
const newSection = buildSection( section, sectionTitle, newContent );

/*
 * `--slurp` collects every paginated page into a single JSON array. Without
 * it, `gh api --paginate` concatenates one `[...]` per page and the combined
 * stdout is no longer valid JSON once a PR has more than ~30 comments.
 */
const list: IssueComment[] = (
	JSON.parse(
		execFileSync(
			'gh',
			[
				'api',
				'--paginate',
				'--slurp',
				`repos/${ repo }/issues/${ prNumber }/comments`,
			],
			{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
		)
	) as IssueComment[][]
).flat();
const existing = list.find(
	( c ): c is IssueComment & { body: string } =>
		c.user?.login === 'github-actions[bot]' &&
		typeof c.body === 'string' &&
		c.body.startsWith( TITLE )
);

let body: string;
if ( existing ) {
	const re = new RegExp(
		`${ startMarker( section ) }[\\s\\S]*?${ endMarker( section ) }`
	);
	body = re.test( existing.body )
		? existing.body.replace( re, newSection )
		: `${ existing.body.trimEnd() }\n\n${ newSection }`;
} else {
	const ordered = SECTIONS.map( ( s ) =>
		s === section ? newSection : placeholder( s )
	).join( '\n\n' );
	body = `${ TITLE }\n\n${ ordered }`;
}

/* Pass the body via a tempfile to avoid argv length limits on large diffs. */
const bodyFile = join(
	tmpdir(),
	`coverage-comment-${ randomBytes( 6 ).toString( 'hex' ) }.json`
);
writeFileSync( bodyFile, JSON.stringify( { body } ) );

if ( existing ) {
	execFileSync(
		'gh',
		[
			'api',
			'--method',
			'PATCH',
			`repos/${ repo }/issues/comments/${ existing.id }`,
			'--input',
			bodyFile,
		],
		{ stdio: 'inherit' }
	);
} else {
	execFileSync(
		'gh',
		[
			'api',
			'--method',
			'POST',
			`repos/${ repo }/issues/${ prNumber }/comments`,
			'--input',
			bodyFile,
		],
		{ stdio: 'inherit' }
	);
}
