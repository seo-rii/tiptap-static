import { describe, expect, it, vi } from 'vitest';

import * as root from '../src/index.js';
import {
	getStaticNodeViewHook,
	hasStaticNodeViewHook,
	setStaticNodeViewHook,
	setStaticNodeViewRuntime,
	STATIC_NODE_VIEW
} from '../src/protocol.js';
import type { StaticNodeViewRenderer } from '../src/protocol.js';

describe('static NodeView protocol', () => {
	it('uses the exact same global Symbol and helpers from the root entry point', () => {
		expect(root.STATIC_NODE_VIEW).toBe(STATIC_NODE_VIEW);
		expect(root.setStaticNodeViewHook).toBe(setStaticNodeViewHook);
		expect(root.setStaticNodeViewRuntime).toBe(setStaticNodeViewRuntime);
		expect(Symbol.keyFor(STATIC_NODE_VIEW)).toBe('@tiptap-static/node-view-renderer/v1');
	});

	it('attaches a non-enumerable direct mount hook', () => {
		const renderer = vi.fn() as unknown as StaticNodeViewRenderer;
		const mount = vi.fn();

		const hooked = setStaticNodeViewHook(renderer, mount);

		expect(hooked).toBe(renderer);
		expect(getStaticNodeViewHook(renderer)).toEqual({ version: 1, mount });
		expect(hasStaticNodeViewHook(renderer)).toBe(true);
		expect(Object.getOwnPropertyDescriptor(renderer, STATIC_NODE_VIEW)).toMatchObject({
			configurable: true,
			enumerable: false,
			writable: false
		});
	});

	it('attaches an opaque runtime descriptor without changing value identity', () => {
		const renderer = vi.fn() as unknown as StaticNodeViewRenderer;
		const runtime = Symbol.for('test-adapter/static-runtime/v1');
		const value = { component: {}, options: { context: new Map() } };

		setStaticNodeViewRuntime(renderer, runtime, value);

		expect(getStaticNodeViewHook(renderer)).toEqual({ version: 1, runtime, value });
		expect(
			(getStaticNodeViewHook(renderer) as { value: unknown }).value
		).toBe(value);
		expect(getStaticNodeViewHook(null)).toBeUndefined();
		expect(hasStaticNodeViewHook('renderer')).toBe(false);
	});
});
