import sanitizeHtml from 'sanitize-html';
import { describe, expect, it } from 'vitest';

import { sanitizeTiptapHTML } from '../src/sanitize.js';
import { createStaticRenderer } from '../src/runtime.js';
import type { StaticSanitizeOptions, TiptapExtensionLike } from '../src/types.js';

describe('explicit sanitizer attribute policies', () => {
	it.each([
		{ baseAttributes: ['sandbox'] },
		{ baseAttributes: [{ name: 'sandbox', multiple: true, values: ['allow-scripts', 'allow-same-origin'] }] }
	])('honors per-call restrictions over renderer attribute policy $baseAttributes', ({ baseAttributes }) => {
		const base = {
			allowedTags: ['iframe'],
			allowedAttributes: { iframe: baseAttributes }
		};
		const renderer = createStaticRenderer({ extensions: [], sanitize: base });
		const html = '<iframe sandbox="allow-scripts allow-same-origin"></iframe>';
		const overrides = {
			allowedAttributes: {
				iframe: [{ name: 'sandbox', multiple: true, values: ['allow-scripts'] }]
			}
		};
		const expected = sanitizeHtml(html, { ...base, ...overrides });

		expect(renderer.sanitize(html, overrides)).toBe(expected);
		expect(expected).toBe('<iframe sandbox="allow-scripts"></iframe>');
		// A per-call restriction must not change the renderer's default policy.
		expect(renderer.sanitize(html)).toBe(html);
	});

	it('applies sandbox token restrictions instead of inferred name-only permissions', () => {
		const iframe: TiptapExtensionLike = {
			name: 'iframe',
			type: 'node',
			config: {
				parseHTML: () => [{ tag: 'iframe' }],
				addAttributes: () => ({ sandbox: { default: '' } })
			}
		};
		const html = '<iframe sandbox="allow-scripts allow-same-origin"></iframe>';
		const options = {
			allowedTags: ['iframe'],
			allowedAttributes: {
				iframe: [{ name: 'sandbox', multiple: true, values: ['allow-scripts'] }]
			}
		};

		expect(sanitizeTiptapHTML(html, [iframe], options)).toBe(sanitizeHtml(html, options));
		expect(sanitizeTiptapHTML(html, [iframe], options)).toBe(
			'<iframe sandbox="allow-scripts"></iframe>'
		);
	});

	it('applies explicit single-value restrictions to default allowed attributes', () => {
		const html = '<a target="_blank">external</a><a target="_self">local</a>';
		const options = {
			allowedAttributes: { a: [{ name: 'target', values: ['_self'] }] }
		};

		expect(sanitizeTiptapHTML(html, [], options)).toBe(sanitizeHtml(html, options));
	});

	it('retains native wildcard and open attribute permissions', () => {
		const html = '<p title="heading" data-value="1" custom="2">text</p>';
		const policies: StaticSanitizeOptions['allowedAttributes'][] = [
			{ '*': ['title', 'data-*'] },
			false
		];
		for (const allowedAttributes of policies) {
			const options = { allowedAttributes };
			expect(sanitizeTiptapHTML(html, [], options)).toBe(sanitizeHtml(html, options));
		}
	});
});
