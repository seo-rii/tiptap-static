import sanitizeHtml from 'sanitize-html';
import { describe, expect, it, vi } from 'vitest';

import { sanitizeTiptapHTML } from '../src/sanitize.js';

describe('sanitizer transform ordering', () => {
	it('runs a wildcard transform exactly once for every tag', () => {
		const transform = vi.fn((tagName: string, attribs: Record<string, string>) => ({
			tagName,
			attribs: { ...attribs, title: `${attribs.title}!` }
		}));
		const html = '<p title="p">paragraph</p><custom-node title="c">custom</custom-node>';
		const clean = sanitizeTiptapHTML(html, [], {
			allowedTags: ['custom-node'],
			allowedAttributes: false,
			transformTags: { '*': transform }
		});

		expect(clean).toBe('<p title="p!">paragraph</p><custom-node title="c!">custom</custom-node>');
		expect(transform).toHaveBeenCalledTimes(2);
	});

	it('matches native tag-then-wildcard transforms', () => {
		const html = '<p title="x">text</p>';
		const options = {
			allowedAttributes: { '*': ['title'] },
			transformTags: {
				p: (tagName: string, attribs: Record<string, string>) => ({
					tagName: 'div',
					attribs: { ...attribs, title: `${attribs.title}:tag` }
				}),
				'*': (tagName: string, attribs: Record<string, string>) => ({
					tagName,
					attribs: { ...attribs, title: `${attribs.title}:wildcard` }
				})
			}
		};

		expect(sanitizeTiptapHTML(html, [], options)).toBe(sanitizeHtml(html, options));
	});

	it('validates attributes once on the final transformed tag', () => {
		const globalValidator = vi.fn((value: string) => `${value}:global`);
		const finalValidator = vi.fn((value: string) => `${value}:final`);
		const intermediateValidator = vi.fn(() => false);
		const clean = sanitizeTiptapHTML('<p title="x">text</p>', [], {
			allowedAttributes: { '*': ['title'] },
			transformTags: { p: 'div', '*': 'span' },
			attributeValidators: {
				'*': { title: globalValidator },
				div: { title: intermediateValidator },
				span: { title: finalValidator }
			}
		});

		expect(clean).toBe('<span title="x:global:final">text</span>');
		expect(globalValidator).toHaveBeenCalledTimes(1);
		expect(finalValidator).toHaveBeenCalledTimes(1);
		expect(intermediateValidator).not.toHaveBeenCalled();
	});

	it('keeps native transformer text replacement', () => {
		const html = '<p>original</p>';
		const options = {
			transformTags: {
				p: (tagName: string, attribs: Record<string, string>) => ({
					tagName,
					attribs,
					text: 'replacement'
				})
			}
		};

		expect(sanitizeTiptapHTML(html, [], options)).toBe(sanitizeHtml(html, options));
	});

	it('removes event attributes added by transforms and retains hard-denied source tags', () => {
		const clean = sanitizeTiptapHTML('<p>text</p><script>secret()</script>', [], {
			allowedTags: false,
			allowedAttributes: false,
			transformTags: {
				script: 'p',
				'*': (tagName, attribs) => ({
					tagName,
					attribs: { ...attribs, onclick: 'bad()', srcdoc: 'bad' }
				})
			}
		});

		expect(clean).toBe('<p>text</p>');
	});
});
