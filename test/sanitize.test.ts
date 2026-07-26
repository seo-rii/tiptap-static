import { Mark } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { sanitizeTiptapHTML } from '../src/sanitize.js';
import type { StaticDiagnostic, TiptapExtensionLike } from '../src/types.js';

function structuralNode(
	name: string,
	config: TiptapExtensionLike['config']
): TiptapExtensionLike {
	return { name, type: 'node', options: {}, storage: {}, config };
}

describe('extension-driven sanitization', () => {
	it('infers tags and attributes from a real Tiptap Mark extension', () => {
		const StaticMark = Mark.create({
			name: 'staticMark',
			addAttributes() {
				return {
					tone: {
						default: 'neutral',
						parseHTML: (element) => element.getAttribute('data-tone'),
						renderHTML: ({ tone }) => ({ 'data-tone': tone })
					}
				};
			},
			parseHTML() {
				return [{ tag: 'static-mark' }];
			},
			renderHTML({ HTMLAttributes }) {
				return ['static-mark', HTMLAttributes, 0];
			}
		});

		const clean = sanitizeTiptapHTML(
			'<static-mark data-tone="accent" onclick="steal()">safe</static-mark>',
			[StaticMark]
		);

		expect(clean).toBe('<static-mark data-tone="accent">safe</static-mark>');
	});

	it('infers custom tags and rendered attributes but always removes event handlers', () => {
		const card = structuralNode('card', {
			parseHTML: () => [{ tag: 'tiptap-card' }],
			addAttributes: () => ({ title: { default: '' }, background: { default: '' } })
		});

		const clean = sanitizeTiptapHTML(
			'<tiptap-card title="hello" background="#fff" onclick="steal()"><p onclick="steal()">ok</p></tiptap-card>',
			[card]
		);

		expect(clean).toBe(
			'<tiptap-card title="hello" background="#fff"><p>ok</p></tiptap-card>'
		);
	});

	it('infers renderHTML attribute mappings and ignores rendered:false attributes', () => {
		const code = structuralNode('codeBlock', {
			parseHTML: () => [{ tag: 'pre' }],
			addAttributes: () => ({
				language: { default: null, rendered: false },
				study: {
					default: false,
					renderHTML: (attrs: Record<string, unknown>) =>
						attrs.study ? { 'data-study': 'true' } : {}
				}
			})
		});

		const clean = sanitizeTiptapHTML(
			'<pre language="typescript" data-study="true">code</pre>',
			[code]
		);

		expect(clean).toBe('<pre data-study="true">code</pre>');
	});

	it('includes mapped global attributes on their target node tags', () => {
		const card = structuralNode('card', { parseHTML: () => [{ tag: 'tiptap-card' }] });
		const resize = structuralNode('resize', {
			addGlobalAttributes: () => [
				{
					types: ['card'],
					attributes: {
						horizontalAlign: {
							default: '',
							renderHTML: (attrs: Record<string, unknown>) => ({
								'data-resize-horizontal-align': attrs.horizontalAlign
							})
						}
					}
				}
			]
		});

		const clean = sanitizeTiptapHTML(
			'<tiptap-card data-resize-horizontal-align="center"></tiptap-card>',
			[card, resize]
		);
		expect(clean).toContain('data-resize-horizontal-align="center"');
	});

	it('blocks script URLs, protocol-relative URLs, srcdoc, scripts, and inline styles by default', () => {
		const clean = sanitizeTiptapHTML(
			'<a href="java&#x73;cript:alert(1)" style="position:fixed" onclick="x()">bad</a><a href="//evil.test/x">relative</a><iframe srcdoc="<script>x()</script>"></iframe><script>alert(1)</script>',
			[],
			{ allowedTags: ['iframe'], allowedAttributes: { iframe: ['srcdoc'] } }
		);

		expect(clean).toBe('<a>bad</a><a>relative</a><iframe></iframe>');
	});

	it('continues to hard-deny scripts and event attributes when allowed lists are explicitly open', () => {
		const clean = sanitizeTiptapHTML(
			'<custom-open onclick="x()">ok<script>alert(1)</script></custom-open>',
			[],
			{ allowedTags: false, allowedAttributes: false }
		);

		expect(clean).toBe('<custom-open>ok</custom-open>');
	});

	it('requires active-content tag opt-in and still applies URL scheme checks', () => {
		const embed = structuralNode('embed', {
			parseHTML: () => [{ tag: 'embed' }],
			addAttributes: () => ({ src: { default: '' }, type: { default: '' } })
		});

		expect(sanitizeTiptapHTML('<embed src="https://example.com/a.pdf">', [embed])).toBe('');
		expect(
			sanitizeTiptapHTML('<embed src="javascript:alert(1)" type="application/pdf">', [embed], {
				allowActiveContentTags: ['embed']
			})
		).toBe('<embed type="application/pdf" />');
	});

	it('applies URL scheme checks to explicitly allowed object data', () => {
		const object = structuralNode('object', {
			parseHTML: () => [{ tag: 'object' }],
			addAttributes: () => ({ data: { default: '' } })
		});

		const clean = sanitizeTiptapHTML(
			'<object data="javascript:alert(1)"></object><object data="https://example.com/file.pdf"></object>',
			[object],
			{ allowActiveContentTags: ['object'] }
		);

		expect(clean).toBe('<object></object><object data="https://example.com/file.pdf"></object>');
	});

	it('applies exact iframe hostname rules and rejects relative iframe URLs by default', () => {
		const clean = sanitizeTiptapHTML(
			'<iframe src="https://media.example.com/embed/1"></iframe><iframe src="https://media.example.com.evil.test/embed/1"></iframe><iframe src="/relative"></iframe>',
			[],
			{
				allowedTags: ['iframe'],
				allowedAttributes: { iframe: ['src'] },
				allowedIframeHostnames: ['media.example.com'],
				allowIframeRelativeUrls: false
			}
		);
		const container = document.createElement('div');
		container.innerHTML = clean;

		expect([...container.querySelectorAll('iframe')].map((iframe) => iframe.getAttribute('src'))).toEqual([
			'https://media.example.com/embed/1',
			null,
			null
		]);
	});

	it('lets applications validate opaque component attributes', () => {
		const card = structuralNode('card', {
			parseHTML: () => [{ tag: 'tiptap-card' }],
			addAttributes: () => ({ background: { default: '' } })
		});

		const clean = sanitizeTiptapHTML(
			'<tiptap-card background="url(javascript:alert(1))"></tiptap-card><tiptap-card background="#aabbcc"></tiptap-card>',
			[card],
			{
				attributeValidators: {
					'tiptap-card': {
						background: (value) => /^#[0-9a-f]{6}$/i.test(value)
					}
				}
			}
		);

		expect(clean).toBe(
			'<tiptap-card></tiptap-card><tiptap-card background="#aabbcc"></tiptap-card>'
		);
	});

	it('fails closed for sanitizer tag inference from complex selectors', () => {
		const diagnostics: StaticDiagnostic[] = [];
		const extension = structuralNode('complex', {
			parseHTML: () => [{ tag: 'figure > custom-image' }]
		});

		const clean = sanitizeTiptapHTML(
			'<figure><custom-image data-id="1"></custom-image></figure>',
			[extension],
			{},
			(diagnostic) => diagnostics.push(diagnostic)
		);

		expect(clean).toBe('<figure></figure>');
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ code: 'sanitize-selector-not-inferred' })
		);
	});

	it('chains wildcard and tag-specific attribute validators', () => {
		const extension = structuralNode('validate-node', {
			parseHTML: () => [{ tag: 'validate-node' }],
			addAttributes: () => ({ value: { default: '' } })
		});

		const clean = sanitizeTiptapHTML('<validate-node value=" raw "></validate-node>', [extension], {
			attributeValidators: {
				'*': { value: (value) => value.trim().toLowerCase() },
				'validate-node': { value: (value) => value === 'raw' }
			}
		});

		expect(clean).toBe('<validate-node value="raw"></validate-node>');
	});

	it('reports failed renderHTML probes and accepts an explicit attribute override', () => {
		const diagnostics: StaticDiagnostic[] = [];
		const extension = structuralNode('probe-node', {
			parseHTML: () => [{ tag: 'probe-node' }],
			addAttributes: () => ({
				mapped: {
					default: false,
					renderHTML: () => {
						throw new Error('needs application state');
					}
				}
			})
		});

		const clean = sanitizeTiptapHTML(
			'<probe-node data-mapped="true"></probe-node>',
			[extension],
			{ allowedAttributes: { 'probe-node': ['data-mapped'] } },
			(diagnostic) => diagnostics.push(diagnostic)
		);

		expect(clean).toBe('<probe-node data-mapped="true"></probe-node>');
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ code: 'attribute-probe-failed', extension: 'probe-node' })
		);
	});

	it('never allows a transform to create a script tag', () => {
		const clean = sanitizeTiptapHTML('<p data-secret="x">safe text</p>', [], {
			allowedAttributes: { p: ['data-secret'] },
			transformTags: { p: 'script' }
		});

		expect(clean).toBe('<span>safe text</span>');
	});
});
