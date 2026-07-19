import { Node } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import { describe, expect, it, vi } from 'vitest';

import { setStaticNodeViewHook } from '../src/protocol.js';
import { createStaticRenderer } from '../src/runtime.js';
import type { StaticNodeViewProps, StaticNodeViewRenderer } from '../src/types.js';
import StaticNodeView from './fixtures/StaticNodeView.svelte';

function makeContainerExtension(
	name: string,
	lifecycle: string[],
	counts: { addNodeView: number; render: number }
) {
	return Node.create({
		name,
		group: 'block',
		content: 'block*',
		addAttributes() {
			return { title: { default: '' } };
		},
		parseHTML() {
			return [{ tag: name }];
		},
		renderHTML({ HTMLAttributes }) {
			return [name, HTMLAttributes, 0];
		},
		addNodeView() {
			counts.addNodeView += 1;
			return ((props: StaticNodeViewProps) => {
				counts.render += 1;
				lifecycle.push(`mount:${name}:${props.node.attrs.title}`);
				const dom = document.createElement('article');
				dom.dataset.view = name;
				const label = document.createElement('strong');
				label.textContent = String(props.node.attrs.title);
				const contentDOM = document.createElement('div');
				contentDOM.dataset.content = name;
				dom.append(label, contentDOM);
				return {
					dom,
					contentDOM,
					destroy() {
						lifecycle.push(`destroy:${name}:${props.node.attrs.title}`);
					}
				};
			}) as never;
		}
	});
}

describe('static NodeView enhancement', () => {
	it('mounts nested existing Tiptap extensions and destroys children before parents', () => {
		const lifecycle: string[] = [];
		const cardCounts = { addNodeView: 0, render: 0 };
		const collapseCounts = { addNodeView: 0, render: 0 };
		const Card = makeContainerExtension('tiptap-card', lifecycle, cardCounts);
		const Collapsable = makeContainerExtension(
			'tiptap-collapsable',
			lifecycle,
			collapseCounts
		);
		const renderer = createStaticRenderer({ extensions: [Card, Collapsable] });
		const target = document.createElement('div');

		const session = renderer.mount(
			target,
			'<tiptap-card title="outer"><p>before</p><tiptap-collapsable title="inner"><p>inside</p></tiptap-collapsable></tiptap-card>'
		);

		expect(target.querySelector('[data-view="tiptap-card"]')).not.toBeNull();
		expect(
			target.querySelector(
				'[data-content="tiptap-card"] [data-view="tiptap-collapsable"] [data-content="tiptap-collapsable"] p'
			)?.textContent
		).toBe('inside');
		expect(cardCounts).toEqual({ addNodeView: 1, render: 1 });
		expect(collapseCounts).toEqual({ addNodeView: 1, render: 1 });
		expect(lifecycle.slice(0, 2)).toEqual([
			'mount:tiptap-card:outer',
			'mount:tiptap-collapsable:inner'
		]);

		session.destroy();
		expect(lifecycle.slice(-2)).toEqual([
			'destroy:tiptap-collapsable:inner',
			'destroy:tiptap-card:outer'
		]);
		expect(target.querySelector('tiptap-card tiptap-collapsable')).not.toBeNull();
		session.destroy();
		expect(lifecycle.filter((entry) => entry.startsWith('destroy:'))).toHaveLength(2);
	});

	it('calls addNodeView once per extension and the renderer once per matching node', () => {
		const lifecycle: string[] = [];
		const counts = { addNodeView: 0, render: 0 };
		const Card = makeContainerExtension('many-card', lifecycle, counts);
		const target = document.createElement('div');
		createStaticRenderer({ extensions: [Card] }).mount(
			target,
			'<many-card title="a"></many-card><many-card title="b"></many-card>'
		);
		expect(counts).toEqual({ addNodeView: 1, render: 2 });
	});

	it('uses the global static hook instead of the raw renderer', () => {
		const raw = vi.fn(() => {
			throw new Error('raw renderer must not run');
		}) as unknown as StaticNodeViewRenderer;
		setStaticNodeViewHook(raw, ({ node }) => {
			const dom = document.createElement('aside');
			dom.dataset.hook = String(node.attrs.id);
			return { dom };
		});
		const HookNode = Node.create({
			name: 'hook-node',
			group: 'block',
			atom: true,
			addAttributes() {
				return { id: { default: '' } };
			},
			parseHTML() {
				return [{ tag: 'hook-node' }];
			},
			renderHTML({ HTMLAttributes }) {
				return ['hook-node', HTMLAttributes];
			},
			addNodeView() {
				return raw as never;
			}
		});
		const target = document.createElement('div');

		createStaticRenderer({ extensions: [HookNode] }).mount(target, '<hook-node id="42" />');

		expect(raw).not.toHaveBeenCalled();
		expect(target.querySelector('aside')?.dataset.hook).toBe('42');
	});

	it('does not retry a failed hook with raw fallback and preserves the sanitized source', () => {
		const raw = vi.fn() as unknown as StaticNodeViewRenderer;
		setStaticNodeViewHook(raw, () => {
			throw new Error('hook failed');
		});
		const extension = Node.create({
			name: 'failed-hook',
			group: 'block',
			atom: true,
			parseHTML: () => [{ tag: 'failed-hook' }],
			renderHTML: () => ['failed-hook'],
			addNodeView: () => raw as never
		});
		const target = document.createElement('div');
		const renderer = createStaticRenderer({ extensions: [extension] });

		renderer.mount(target, '<failed-hook></failed-hook>');

		expect(raw).not.toHaveBeenCalled();
		expect(target.querySelector('failed-hook')).not.toBeNull();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'mount-failed', extension: 'failed-hook' })
		);
	});

	it('can disable the compatibility fallback', () => {
		const lifecycle: string[] = [];
		const counts = { addNodeView: 0, render: 0 };
		const extension = makeContainerExtension('raw-node', lifecycle, counts);
		const target = document.createElement('div');
		const renderer = createStaticRenderer({ extensions: [extension], rawNodeViews: false });

		renderer.mount(target, '<raw-node><p>kept</p></raw-node>');

		expect(counts).toEqual({ addNodeView: 1, render: 0 });
		expect(target.querySelector('raw-node p')?.textContent).toBe('kept');
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'raw-node-view-disabled' })
		);
	});

	it('unwraps the CodeBlock DOMOutputSpec hole before attaching contentDOM', () => {
		let received: StaticNodeViewProps | undefined;
		const StaticCodeBlock = CodeBlock.extend({
			addNodeView() {
				return ((props: StaticNodeViewProps) => {
					received = props;
					const dom = document.createElement('section');
					const contentDOM = document.createElement('div');
					contentDOM.dataset.codeContent = '';
					dom.append(contentDOM);
					return { dom, contentDOM };
				}) as never;
			}
		});
		const target = document.createElement('div');
		createStaticRenderer({
			extensions: [StaticCodeBlock],
			sanitize: { allowedAttributes: { code: ['class'] } }
		}).mount(target, '<pre><code class="language-typescript">const answer = 42;</code></pre>');

		expect(received?.node.attrs.language).toBe('typescript');
		expect(received?.node.textContent).toBe('const answer = 42;');
		expect(target.querySelector('[data-code-content]')?.childNodes).toHaveLength(1);
		expect(target.querySelector('[data-code-content]')?.firstChild?.nodeType).toBe(
			window.Node.TEXT_NODE
		);
		expect(target.querySelector('[data-code-content] code')).toBeNull();
	});

	it('updates in place, destroys the previous tree, and keeps the editor facade read-only', () => {
		let capturedEditor: Record<string, any> | undefined;
		let destroyed = 0;
		const extension = Node.create({
			name: 'facade-node',
			group: 'block',
			atom: true,
			parseHTML: () => [{ tag: 'facade-node' }],
			renderHTML: () => ['facade-node'],
			addNodeView() {
				return ((props: StaticNodeViewProps) => {
					capturedEditor = props.editor;
					const dom = document.createElement('output');
					return { dom, destroy: () => (destroyed += 1) };
				}) as never;
			}
		});
		const target = document.createElement('div');
		const session = createStaticRenderer({ extensions: [extension] }).mount(
			target,
			'<facade-node />'
		);

		expect(capturedEditor?.options.editable).toBe(false);
		expect(capturedEditor?.commands.setContent('bad')).toBe(false);
		session.update('<p>plain</p>');
		expect(destroyed).toBe(1);
		expect(target.innerHTML).toBe('<p>plain</p>');
	});

	it('runs the existing svelte-tiptap NodeView renderer through the compatibility fallback', () => {
		const SvelteCard = Node.create({
			name: 'svelte-card',
			group: 'block',
			content: 'block*',
			addAttributes() {
				return { title: { default: '' } };
			},
			parseHTML() {
				return [{ tag: 'svelte-card' }];
			},
			renderHTML({ HTMLAttributes }) {
				return ['svelte-card', HTMLAttributes, 0];
			},
			addNodeView() {
				return SvelteNodeViewRenderer(StaticNodeView);
			}
		});
		const target = document.createElement('div');

		const renderer = createStaticRenderer({ extensions: [SvelteCard] });
		const session = renderer.mount(
			target,
			'<svelte-card title="actual adapter"><p>nested content</p></svelte-card>'
		);

		expect({ html: target.innerHTML, diagnostics: renderer.diagnostics }).toMatchObject({
			html: expect.stringContaining('data-real-svelte-node-view'),
			diagnostics: []
		});
		expect(target.querySelector('[data-real-svelte-node-view] strong')?.textContent).toBe(
			'actual adapter'
		);
		expect(target.querySelector('[data-real-svelte-node-view]')?.getAttribute('data-editable')).toBe(
			'false'
		);
		expect(target.querySelector('[data-static-content] p')?.textContent).toBe('nested content');

		session.destroy();
		expect(target.querySelector('svelte-card p')?.textContent).toBe('nested content');
	});

	it('preserves custom parseHTML string values and shares node type identity with addNodeView', () => {
		let parsedValue: unknown;
		let sameType = false;
		const extension = Node.create({
			name: 'typed-node',
			group: 'block',
			atom: true,
			addAttributes() {
				return {
					value: {
						default: '',
						parseHTML: () => '12'
					}
				};
			},
			parseHTML: () => [{ tag: 'typed-node' }],
			renderHTML: ({ HTMLAttributes }) => ['typed-node', HTMLAttributes],
			addNodeView() {
				const extensionType = this.type;
				return ((props: StaticNodeViewProps) => {
					parsedValue = props.node.attrs.value;
					sameType = props.node.type === extensionType;
					return { dom: document.createElement('span') };
				}) as never;
			}
		});
		const target = document.createElement('div');

		createStaticRenderer({ extensions: [extension] }).mount(target, '<typed-node />');

		expect(parsedValue).toBe('12');
		expect(sameType).toBe(true);
	});

	it('unions renderer-level and call-level sanitizer attributes per tag', () => {
		const renderer = createStaticRenderer({
			extensions: [],
			sanitize: {
				allowedTags: ['merge-node'],
				allowedAttributes: { 'merge-node': ['data-base'] }
			}
		});

		expect(
			renderer.sanitize(
				'<merge-node data-base="a" data-call="b" data-no="c"></merge-node>',
				{ allowedAttributes: { 'merge-node': ['data-call'] } }
			)
		).toBe('<merge-node data-base="a" data-call="b"></merge-node>');
	});

	it('sanitizes the DOM before parse rules or NodeView code can inspect it', () => {
		let sawEventAttribute: boolean | undefined;
		const extension = Node.create({
			name: 'sanitize-first',
			group: 'block',
			atom: true,
			parseHTML() {
				return [
					{
						tag: 'sanitize-first',
						getAttrs: (element) => {
							sawEventAttribute = element.hasAttribute('onclick');
							return {};
						}
					}
				];
			},
			renderHTML: () => ['sanitize-first'],
			addNodeView() {
				return (() => ({ dom: document.createElement('span') })) as never;
			}
		});
		const target = document.createElement('div');

		createStaticRenderer({ extensions: [extension] }).mount(
			target,
			'<sanitize-first onclick="steal()"></sanitize-first>'
		);

		expect(sawEventAttribute).toBe(false);
	});

	it('cleans up an invalid NodeView, preserves its source, and continues with siblings', () => {
		const destroyed: string[] = [];
		const extension = Node.create({
			name: 'validated-view',
			group: 'block',
			atom: true,
			addAttributes() {
				return { id: { default: '' } };
			},
			parseHTML: () => [{ tag: 'validated-view' }],
			renderHTML: ({ HTMLAttributes }) => ['validated-view', HTMLAttributes],
			addNodeView() {
				return (({ node }: StaticNodeViewProps) => {
					const dom = document.createElement('section');
					dom.dataset.mounted = String(node.attrs.id);
					return {
						dom,
						contentDOM:
							node.attrs.id === 'bad' ? document.createElement('div') : undefined,
						destroy: () => destroyed.push(String(node.attrs.id))
					};
				}) as never;
			}
		});
		const target = document.createElement('div');
		const renderer = createStaticRenderer({ extensions: [extension] });

		renderer.mount(
			target,
			'<validated-view id="bad"></validated-view><validated-view id="good"></validated-view>'
		);

		expect(target.querySelector('section[data-mounted="bad"]')).toBeNull();
		expect(target.querySelector('validated-view[id="bad"]')).not.toBeNull();
		expect(target.querySelector('section[data-mounted="good"]')).not.toBeNull();
		expect(destroyed).toEqual(['bad']);
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'invalid-content-dom', extension: 'validated-view' })
		);
	});
});
