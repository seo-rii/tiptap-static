import { describe, expect, it, vi } from 'vitest';

import { createLightRenderer } from '../src/light.js';
import {
	setStaticNodeViewHook,
	setStaticNodeViewRuntime,
	STATIC_NODE_VIEW,
	type StaticNodeViewProps,
	type StaticNodeViewRenderer,
	type StaticNodeViewRuntime,
	type TiptapExtensionLike
} from '../src/protocol.js';
import { createStaticRenderer } from '../src/runtime.js';

function makeExtension(
	name: string,
	renderer: StaticNodeViewRenderer,
	config: Record<string, unknown> = {}
): TiptapExtensionLike {
	return {
		name,
		type: 'node',
		options: {},
		storage: {},
		config: {
			atom: true,
			parseHTML: () => [{ tag: name }],
			renderHTML: () => [name],
			addNodeView: () => renderer,
			...config
		},
		parent: null
	};
}

describe('sanitizer-free light runtime', () => {
	it('treats mount and update HTML as trusted input without sanitizing it', () => {
		const renderer = createLightRenderer({ extensions: [] });
		const target = document.createElement('div');
		const unsafe = '<p onclick="window.stolen=true">kept</p><script>alsoKept()</script>';

		const session = renderer.mount(target, unsafe);

		expect(target.querySelector('p')?.hasAttribute('onclick')).toBe(true);
		expect(target.querySelector('script')?.textContent).toBe('alsoKept()');
		session.update('<p onmouseover="unsafe()">updated</p>');
		expect(target.querySelector('p')?.hasAttribute('onmouseover')).toBe(true);
	});

	it('keeps sanitization in the full renderer, including session updates', () => {
		const renderer = createStaticRenderer({ extensions: [] });
		const target = document.createElement('div');
		const session = renderer.mount(
			target,
			'<p onclick="unsafe()">safe</p><script>removed()</script>'
		);

		expect(target.innerHTML).toBe('<p>safe</p>');
		session.update('<p onmouseover="unsafe()">updated</p><script>removed()</script>');
		expect(target.innerHTML).toBe('<p>updated</p>');
	});

	it('uses descriptor runtimes with framework-neutral props and lifecycle', () => {
		const raw = vi.fn(() => {
			throw new Error('the editor renderer must not run');
		}) as unknown as StaticNodeViewRenderer;
		const runtimeKey = Symbol.for('fixture-framework/static-runtime/v1');
		const descriptor = { component: {}, options: { mode: 'read-only' } };
		setStaticNodeViewRuntime(raw, runtimeKey, descriptor);
		const inputs: Array<{ value: unknown; props: StaticNodeViewProps }> = [];
		const lifecycle: string[] = [];
		const runtime: StaticNodeViewRuntime = {
			key: runtimeKey,
			mount(input) {
				inputs.push(input);
				input.props.updateAttributes({ ignored: true });
				input.props.deleteNode();
				const dom = document.createElement('article');
				dom.dataset.runtime = String(input.props.node.attrs.id);
				return {
					dom,
					destroy: () => lifecycle.push(`destroy:${String(input.props.node.attrs.id)}`)
				};
			}
		};
		const extension = makeExtension('runtime-node', raw, {
			addAttributes: () => ({ id: { default: '' } }),
			renderHTML: ({ HTMLAttributes }: Record<string, any>) => [
				'runtime-node',
				HTMLAttributes
			]
		});
		const target = document.createElement('div');
		const session = createLightRenderer({
			extensions: [extension],
			nodeViewRuntimes: [runtime]
		}).mount(target, '<runtime-node id="one"></runtime-node>');

		expect(raw).not.toHaveBeenCalled();
		expect(inputs[0]?.value).toBe(descriptor);
		expect(inputs[0]?.props).toMatchObject({
			selected: false,
			HTMLAttributes: { id: 'one' }
		});
		expect(target.querySelector('article')?.dataset.runtime).toBe('one');

		session.update('<runtime-node id="two"></runtime-node>');
		expect(lifecycle).toEqual(['destroy:one']);
		expect(inputs).toHaveLength(2);
		session.destroy();
		expect(lifecycle).toEqual(['destroy:one', 'destroy:two']);
		expect(target.querySelector('runtime-node')?.getAttribute('id')).toBe('two');
	});

	it('does not invoke raw NodeViews by default', () => {
		const raw = vi.fn(() => ({ dom: document.createElement('output') })) as unknown as StaticNodeViewRenderer;
		const extension = makeExtension('raw-light-node', raw);
		const target = document.createElement('div');
		const renderer = createLightRenderer({ extensions: [extension] });

		renderer.mount(target, '<raw-light-node></raw-light-node>');

		expect(raw).not.toHaveBeenCalled();
		expect(target.querySelector('raw-light-node')).not.toBeNull();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'raw-node-view-disabled' })
		);
	});

	it('preserves source and never retries a descriptor through raw fallback', () => {
		const raw = vi.fn(() => ({ dom: document.createElement('output') })) as unknown as StaticNodeViewRenderer;
		const runtimeKey = Symbol.for('missing-framework/static-runtime/v1');
		setStaticNodeViewRuntime(raw, runtimeKey, { component: {} });
		const extension = makeExtension('missing-runtime-node', raw);
		const target = document.createElement('div');
		const renderer = createLightRenderer({ extensions: [extension], rawNodeViews: true });

		renderer.mount(target, '<missing-runtime-node></missing-runtime-node>');

		expect(raw).not.toHaveBeenCalled();
		expect(target.querySelector('missing-runtime-node')).not.toBeNull();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'missing-node-view-runtime' })
		);
	});

	it('does not retry a throwing registered runtime through raw fallback', () => {
		const raw = vi.fn(() => ({ dom: document.createElement('output') })) as unknown as StaticNodeViewRenderer;
		const runtimeKey = Symbol.for('throwing-framework/static-runtime/v1');
		setStaticNodeViewRuntime(raw, runtimeKey, { component: {} });
		const renderer = createLightRenderer({
			extensions: [makeExtension('throwing-runtime-node', raw)],
			rawNodeViews: true,
			nodeViewRuntimes: [
				{
					key: runtimeKey,
					mount() {
						throw new Error('framework mount failed');
					}
				}
			]
		});
		const target = document.createElement('div');

		renderer.mount(target, '<throwing-runtime-node></throwing-runtime-node>');

		expect(raw).not.toHaveBeenCalled();
		expect(target.querySelector('throwing-runtime-node')).not.toBeNull();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'mount-failed' })
		);
	});

	it('reports duplicate runtime keys and keeps the first registration', () => {
		const key = Symbol.for('duplicate-framework/static-runtime/v1');
		const first = vi.fn(() => ({ dom: document.createElement('output') }));
		const second = vi.fn(() => ({ dom: document.createElement('aside') }));
		const raw = vi.fn() as unknown as StaticNodeViewRenderer;
		setStaticNodeViewRuntime(raw, key, 'component');
		const renderer = createLightRenderer({
			extensions: [makeExtension('duplicate-runtime-node', raw)],
			nodeViewRuntimes: [
				{ key, mount: first },
				{ key, mount: second }
			]
		});

		renderer.mount(
			document.createElement('div'),
			'<duplicate-runtime-node></duplicate-runtime-node>'
		);

		expect(first).toHaveBeenCalledOnce();
		expect(second).not.toHaveBeenCalled();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'duplicate-node-view-runtime' })
		);
	});

	it('restores the original enhanced nodes and their listeners on destroy', () => {
		const destroy = vi.fn();
		const raw = vi.fn() as unknown as StaticNodeViewRenderer;
		setStaticNodeViewHook(raw, () => {
			const dom = document.createElement('article');
			const contentDOM = document.createElement('div');
			dom.append(contentDOM);
			return { dom, contentDOM, destroy };
		});
		const extension = makeExtension('identity-node', raw, {
			atom: false,
			content: 'block*',
			renderHTML: () => ['identity-node', 0]
		});
		const target = document.createElement('div');
		const source = document.createElement('identity-node');
		const button = document.createElement('button');
		const listener = vi.fn();
		button.textContent = 'original';
		button.addEventListener('click', listener);
		source.append(button);
		target.append(source);

		const session = createLightRenderer({ extensions: [extension] }).enhance(target);

		expect(target.querySelector('article button')).toBe(button);
		button.click();
		expect(listener).toHaveBeenCalledOnce();
		session.destroy();
		expect(target.firstChild).toBe(source);
		expect(source.firstChild).toBe(button);
		button.click();
		expect(listener).toHaveBeenCalledTimes(2);
		expect(destroy).toHaveBeenCalledOnce();
	});

	it('shares target ownership between the full and light renderers', () => {
		const fullDestroy = vi.fn();
		const lightDestroy = vi.fn();
		const fullRaw = vi.fn(() => ({
			dom: Object.assign(document.createElement('output'), { textContent: 'full' }),
			destroy: fullDestroy
		})) as unknown as StaticNodeViewRenderer;
		const lightRaw = vi.fn() as unknown as StaticNodeViewRenderer;
		setStaticNodeViewHook(lightRaw, () => ({
			dom: Object.assign(document.createElement('output'), { textContent: 'light' }),
			destroy: lightDestroy
		}));
		const target = document.createElement('div');
		const fullSession = createStaticRenderer({
			extensions: [makeExtension('full-owner-node', fullRaw)]
		}).mount(target, '<full-owner-node></full-owner-node>');
		const lightSession = createLightRenderer({
			extensions: [makeExtension('light-owner-node', lightRaw)]
		}).mount(target, '<light-owner-node></light-owner-node>');

		expect(fullDestroy).toHaveBeenCalledOnce();
		expect(target.textContent).toBe('light');
		fullSession.destroy();
		expect(target.textContent).toBe('light');
		lightSession.destroy();
		expect(lightDestroy).toHaveBeenCalledOnce();
		expect(target.querySelector('light-owner-node')).not.toBeNull();
	});

	it('diagnoses malformed hook versions without calling the raw renderer', () => {
		const raw = vi.fn() as unknown as StaticNodeViewRenderer;
		Object.defineProperty(raw, STATIC_NODE_VIEW, {
			value: { version: 2, mount: vi.fn() }
		});
		const renderer = createLightRenderer({
			extensions: [makeExtension('future-hook-node', raw)],
			rawNodeViews: true
		});
		const target = document.createElement('div');

		renderer.mount(target, '<future-hook-node></future-hook-node>');

		expect(raw).not.toHaveBeenCalled();
		expect(renderer.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'invalid-node-view-hook' })
		);
	});
});
