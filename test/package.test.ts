import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageRoot = process.cwd();

describe('published package boundary', () => {
	it('uses the unscoped tiptap-static package name everywhere users import it', () => {
		const packageJSON = JSON.parse(
			readFileSync(resolve(packageRoot, 'package.json'), 'utf8')
		) as {
			name: string;
			engines: { node: string };
			exports: Record<string, unknown>;
			homepage: string;
			bugs: { url: string };
		};
		const readme = readFileSync(resolve(packageRoot, 'README.md'), 'utf8');

		expect(packageJSON.name).toBe('tiptap-static');
		expect(packageJSON.engines.node).toBe('>=22.12.0');
		expect(packageJSON.homepage).toBe('https://github.com/seo-rii/tiptap-static#readme');
		expect(packageJSON.bugs.url).toBe('https://github.com/seo-rii/tiptap-static/issues');
		expect(packageJSON.exports).toHaveProperty('.');
		expect(packageJSON.exports).toHaveProperty('./light');
		expect(packageJSON.exports).toHaveProperty('./hydrate');
		expect(packageJSON.exports).toHaveProperty('./protocol');
		expect(packageJSON.exports).toHaveProperty('./sanitize');
		expect(readme).toContain("from 'tiptap-static'");
		expect(readme).not.toMatch(/from '@[^']+\/tiptap-static'/);
	});

	it('keeps Tiptap and ProseMirror imports out of all runtime source files', () => {
		const sourceDirectory = resolve(packageRoot, 'src');
		const runtimeSource = readdirSync(sourceDirectory)
			.filter((name) => name.endsWith('.ts'))
			.map((name) => readFileSync(resolve(sourceDirectory, name), 'utf8'))
			.join('\n');

		expect(runtimeSource).not.toMatch(/from ['"]@tiptap\//);
		expect(runtimeSource).not.toMatch(/from ['"](?:@tiptap\/pm|prosemirror-)/);
		expect(packageRoot).toMatch(/tiptap-static$/);
	});
});
