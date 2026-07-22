import { describe, expect, it, vi } from 'vitest';

import { createHydrator, defineStaticNode } from '../src/hydrate.js';
import { createLightRenderer } from '../src/light.js';
import {
	createStaticNodeViewHook,
	createStaticNodeViewRuntimeHook,
	setStaticNodeViewHook,
	type StaticNodeViewMount,
	type StaticNodeViewRenderer,
	type TiptapExtensionLike
} from '../src/protocol.js';
import type { StaticNodePlan, StaticNodeViewProps } from '../src/types.js';

function createContainerPlan(name: string, mount: StaticNodeViewMount): StaticNodePlan {
	return defineStaticNode({
		name,
		rules: [
			{
				selector: name,
				parse: (element) => {
					const id = element.getAttribute('id') ?? '';
					return { attrs: { id }, HTMLAttributes: { id } };
				}
			}
		],
		type: { isLeaf: false, spec: { content: 'block*' } },
		nodeView: createStaticNodeViewHook(mount)
	});
}

describe('prepared static hydration', () => {
	it('hydrates nested nodes and restores exact source DOM in child-first order', () => {
		const lifecycle: string[] = [];
		const plan = createContainerPlan('prepared-node', ({ node }) => {
			const id = String(node.attrs.id);
			lifecycle.push(`mount:${id}`);
			const dom = document.createElement('article');
			dom.dataset.preparedId = id;
			const contentDOM = document.createElement('section');
			dom.append(contentDOM);
			return {
				dom,
				contentDOM,
				destroy: () => lifecycle.push(`destroy:${id}`)
			};
		});
		const target = document.createElement('div');
		const outer = document.createElement('prepared-node');
		const inner = document.createElement('prepared-node');
		const button = document.createElement('button');
		const clicked = vi.fn();
		outer.id = 'outer';
		inner.id = 'inner';
		button.textContent = 'kept';
		button.addEventListener('click', clicked);
		inner.append(document.createTextNode('inside'));
		outer.append(button, inner);
		target.append(outer);

		const renderer = createHydrator({ nodes: [plan] });
		const session = renderer.enhance(target);

		expect(lifecycle).toEqual(['mount:outer', 'mount:inner']);
		expect(
			target.querySelector('[data-prepared-id="outer"] [data-prepared-id="inner"]')
		).not.toBeNull();
		expect(target.querySelector('[data-prepared-id="outer"] button')).toBe(button);
		button.click();
		expect(clicked).toHaveBeenCalledOnce();

		session.destroy();
		expect(lifecycle).toEqual([
			'mount:outer',
			'mount:inner',
			'destroy:inner',
			'destroy:outer'
		]);
		expect(target.firstElementChild).toBe(outer);
		expect(outer.querySelector('prepared-node')).toBe(inner);
		expect(outer.querySelector('button')).toBe(button);
		button.click();
		expect(clicked).toHaveBeenCalledTimes(2);
		expect(renderer.diagnostics).toEqual([]);

		session.destroy();
		expect(lifecycle.filter((entry) => entry.startsWith('destroy:'))).toHaveLength(2);
	});

	it('uses a prepared runtime descriptor with mapped attributes and the read-only facade', () => {
		const key = Symbol.for('fixture/prepared-runtime/v1');
		const descriptor = { component: 'Fixture', variant: 'compact' };
		const inputs: Array<{ value: unknown; props: StaticNodeViewProps }> = [];
		const destroyed: number[] = [];
		const firstMount = vi.fn(({ value, props }) => {
			inputs.push({ value, props });
			const dom = document.createElement('output');
			dom.dataset.count = String(props.node.attrs.count);
			return {
				dom,
				destroy: () => destroyed.push(Number(props.node.attrs.count))
			};
		});
		const ignoredMount = vi.fn(() => ({ dom: document.createElement('aside') }));
		const plan = defineStaticNode({
			name: 'runtime-node',
			rules: [
				{
					selector: 'runtime-node',
					parse(element) {
						const count = Number(element.getAttribute('count') ?? 0);
						const enabled = element.hasAttribute('enabled');
						return {
							attrs: { count, enabled },
							HTMLAttributes: { 'data-count': String(count), 'data-enabled': enabled }
						};
					}
				}
			],
			type: { isLeaf: true, isInline: true, isAtom: true },
			nodeView: createStaticNodeViewRuntimeHook(key, descriptor),
			options: { mode: 'read-only' },
			storage: { cached: true }
		});
		const renderer = createHydrator({
			nodes: [plan],
			nodeViewRuntimes: [
				{ key, mount: firstMount },
				{ key, mount: ignoredMount }
			]
		});
		const target = document.createElement('div');
		const session = renderer.mount(target, '<runtime-node count="3" enabled></runtime-node>');

		expect(inputs[0]?.value).toBe(descriptor);
		expect(inputs[0]?.props.node).toMatchObject({
			attrs: { count: 3, enabled: true },
			isInline: true,
			isLeaf: true,
			isAtom: true
		});
		expect(inputs[0]?.props.node.type.spec).toMatchObject({ inline: true, atom: true });
		expect(inputs[0]?.props.HTMLAttributes).toEqual({
			'data-count': '3',
			'data-enabled': true
		});
		expect(inputs[0]?.props.editor.options.editable).toBe(false);
		expect(inputs[0]?.props.editor.commands.setContent('ignored')).toBe(false);
		expect(inputs[0]?.props.editor.chain().focus().run()).toBe(false);
		expect(inputs[0]?.props.editor.extensionStorage['runtime-node']).toEqual({ cached: true });
		expect(inputs[0]?.props.extension).toMatchObject({
			name: 'runtime-node',
			options: { mode: 'read-only' },
			storage: { cached: true }
		});
		expect(inputs[0]?.props.view.dom).toBe(target);
		expect(target.querySelector('output')?.dataset.count).toBe('3');

		session.update('<runtime-node count="7"></runtime-node>');
		expect(destroyed).toEqual([3]);
		expect(target.querySelector('output')?.dataset.count).toBe('7');
		session.destroy();
		expect(destroyed).toEqual([3, 7]);
		expect(target.querySelector('runtime-node')?.getAttribute('count')).toBe('7');
		expect(firstMount).toHaveBeenCalledTimes(2);
		expect(ignoredMount).not.toHaveBeenCalled();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'duplicate-node-view-runtime',
				message: expect.stringContaining('fixture/prepared-runtime/v1')
			})
		);
	});

	it('moves only an explicit content hole and restores its original wrapper', () => {
		let received: StaticNodeViewProps | undefined;
		const plan = defineStaticNode({
			name: 'prepared-code',
			rules: [
				{
					selector: 'pre[data-prepared-code]',
					contentElement: 'code',
					parse: () => ({ attrs: { language: 'ts' }, HTMLAttributes: { 'data-language': 'ts' } })
				}
			],
			type: { isLeaf: false, spec: { content: 'text*' } },
			nodeView: createStaticNodeViewHook((props) => {
				received = props;
				const dom = document.createElement('section');
				const contentDOM = document.createElement('div');
				contentDOM.dataset.codeContent = '';
				dom.append(contentDOM);
				return { dom, contentDOM };
			})
		});
		const target = document.createElement('div');
		target.innerHTML =
			'<pre data-prepared-code><span>outside</span><code>inside<strong> bold</strong></code></pre>';
		const source = target.firstElementChild;
		const sourceCode = source?.querySelector('code');

		const session = createHydrator({ nodes: [plan] }).enhance(target);

		expect(received?.node.textContent).toBe('inside bold');
		expect(received?.HTMLAttributes).toEqual({ 'data-language': 'ts' });
		expect(target.querySelector('[data-code-content]')?.textContent).toBe('inside bold');
		expect(target.querySelector('[data-code-content] code')).toBeNull();
		expect(target.textContent).not.toContain('outside');

		session.destroy();
		expect(target.firstElementChild).toBe(source);
		expect(source?.querySelector('code')).toBe(sourceCode);
		expect(source?.querySelector('span')?.textContent).toBe('outside');
	});

	it('fails a bad parent content hole closed but continues hydrating nested nodes', () => {
		const parentMount = vi.fn(() => ({ dom: document.createElement('article') }));
		const childMount = vi.fn(() => ({ dom: document.createElement('output') }));
		const parent = defineStaticNode({
			name: 'bad-parent',
			rules: [{ selector: 'bad-parent', contentElement: '.missing' }],
			type: { isLeaf: false },
			nodeView: createStaticNodeViewHook(parentMount)
		});
		const child = defineStaticNode({
			name: 'prepared-child',
			rules: [{ selector: 'prepared-child' }],
			type: { isLeaf: true },
			nodeView: createStaticNodeViewHook(childMount)
		});
		const renderer = createHydrator({ nodes: [parent, child] });
		const target = document.createElement('div');

		renderer.mount(target, '<bad-parent><prepared-child></prepared-child></bad-parent>');

		expect(parentMount).not.toHaveBeenCalled();
		expect(childMount).toHaveBeenCalledOnce();
		expect(target.querySelector('bad-parent output')).not.toBeNull();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'unresolved-content-hole', extension: 'bad-parent' })
		);
	});

	it('preserves source nodes for missing runtimes and malformed plans', () => {
		const missingKey = Symbol.for('fixture/missing-runtime/v1');
		const invalidSelector = defineStaticNode({
			name: 'invalid-selector-node',
			rules: [{ selector: '[' }],
			type: { isLeaf: true },
			nodeView: createStaticNodeViewHook(() => ({ dom: document.createElement('output') }))
		});
		const missingRuntime = defineStaticNode({
			name: 'missing-runtime-node',
			rules: [{ selector: 'missing-runtime-node' }],
			type: { isLeaf: true },
			nodeView: createStaticNodeViewRuntimeHook(missingKey, 'component')
		});
		const invalidRuntimeHook = defineStaticNode({
			name: 'invalid-runtime-hook-node',
			rules: [{ selector: 'invalid-runtime-hook-node' }],
			type: { isLeaf: true },
			nodeView: { version: 1, runtime: 123, value: null } as unknown as StaticNodePlan['nodeView']
		});
		const nullHook = defineStaticNode({
			name: 'null-hook-node',
			rules: [{ selector: 'null-hook-node' }],
			type: { isLeaf: true },
			nodeView: null as unknown as StaticNodePlan['nodeView']
		});
		const errors: unknown[] = [];
		const renderer = createHydrator({
			nodes: [invalidSelector, missingRuntime, invalidRuntimeHook, nullHook],
			onError: (error) => errors.push(error)
		});
		const target = document.createElement('div');

		renderer.mount(
			target,
			'<missing-runtime-node></missing-runtime-node><missing-runtime-node></missing-runtime-node><invalid-runtime-hook-node></invalid-runtime-hook-node><null-hook-node></null-hook-node>'
		);

		expect(target.querySelectorAll('missing-runtime-node')).toHaveLength(2);
		expect(target.querySelector('invalid-runtime-hook-node')).not.toBeNull();
		expect(target.querySelector('null-hook-node')).not.toBeNull();
		expect(
			renderer.diagnostics.filter((diagnostic) => diagnostic.code === 'invalid-selector')
		).toHaveLength(1);
		expect(
			renderer.diagnostics.filter(
				(diagnostic) => diagnostic.code === 'missing-node-view-runtime'
			)
		).toHaveLength(2);
		expect(
			renderer.diagnostics.filter(
				(diagnostic) => diagnostic.code === 'invalid-node-view-hook'
			)
		).toHaveLength(2);
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'invalid-node-view-hook',
				message: expect.stringContaining('invalid-runtime-hook-node')
			})
		);
		expect(errors).toHaveLength(5);
	});

	it('shares target ownership with the extension-compatible light renderer', () => {
		const hydrateDestroy = vi.fn();
		const lightDestroy = vi.fn();
		const hydratePlan = defineStaticNode({
			name: 'hydrate-owner',
			rules: [{ selector: 'hydrate-owner' }],
			type: { isLeaf: true },
			nodeView: createStaticNodeViewHook(() => ({
				dom: Object.assign(document.createElement('output'), { textContent: 'hydrate' }),
				destroy: hydrateDestroy
			}))
		});
		const raw = vi.fn() as unknown as StaticNodeViewRenderer;
		setStaticNodeViewHook(raw, () => ({
			dom: Object.assign(document.createElement('output'), { textContent: 'light' }),
			destroy: lightDestroy
		}));
		const extension: TiptapExtensionLike = {
			name: 'light-owner',
			type: 'node',
			options: {},
			storage: {},
			parent: null,
			config: {
				atom: true,
				parseHTML: () => [{ tag: 'light-owner' }],
				renderHTML: () => ['light-owner'],
				addNodeView: () => raw
			}
		};
		const target = document.createElement('div');
		const first = createHydrator({ nodes: [hydratePlan] }).mount(
			target,
			'<hydrate-owner></hydrate-owner>'
		);
		const second = createLightRenderer({ extensions: [extension] }).mount(
			target,
			'<light-owner></light-owner>'
		);

		expect(hydrateDestroy).toHaveBeenCalledOnce();
		expect(target.textContent).toBe('light');
		first.destroy();
		expect(target.textContent).toBe('light');
		second.destroy();
		expect(lightDestroy).toHaveBeenCalledOnce();
		expect(target.querySelector('light-owner')).not.toBeNull();
	});
});
