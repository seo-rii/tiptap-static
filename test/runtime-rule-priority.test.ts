import { Node, getSchema } from '@tiptap/core';
import { DOMParser } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';

import { createLightRenderer } from '../src/light.js';

const Document = Node.create({ name: 'doc', topNode: true, content: 'block*' });
const Text = Node.create({ name: 'text', group: 'inline' });

describe('node parse-rule priority', () => {
	it.each([
		{ rulePriority: 100, extensionPriority: 100, rejected: false },
		{ rulePriority: 50, extensionPriority: 200, rejected: false },
		{ rulePriority: 100, extensionPriority: 100, rejected: true }
	])('respects rules without NodeViews: %j', ({ rulePriority, extensionPriority, rejected }) => {
		const enhanced = vi.fn(() => {
			const dom = document.createElement('section');
			dom.dataset.enhancedCard = '';
			return { dom, contentDOM: dom };
		});
		const badge = vi.fn(() => {
			const dom = document.createElement('span');
			dom.dataset.enhancedBadge = '';
			return { dom };
		});
		const Fallback = Node.create({
			name: 'enhancedCard',
			group: 'block',
			content: 'inline*',
			parseHTML: () => [{ tag: 'x-card' }],
			renderHTML: () => ['x-card', 0],
			addNodeView: () => enhanced
		});
		const Plain = Node.create({
			name: 'plainCard',
			priority: extensionPriority,
			group: 'block',
			content: 'inline*',
			parseHTML: () => [{ tag: 'x-card', priority: rulePriority, getAttrs: () => rejected ? false : null }],
			renderHTML: () => ['x-card', 0]
		});
		const Badge = Node.create({
			name: 'badge',
			group: 'inline',
			inline: true,
			atom: true,
			parseHTML: () => [{ tag: 'x-badge' }],
			renderHTML: () => ['x-badge'],
			addNodeView: () => badge
		});
		// The lower-priority NodeView precedes the plain node in extension order.
		const extensions = [Document, Text, Fallback, Plain, Badge];
		const target = document.createElement('div');
		target.innerHTML = '<x-card>text<x-badge></x-badge></x-card>';
		const source = target.firstElementChild;
		const parsed = DOMParser.fromSchema(getSchema(extensions)).parse(target);
		expect(parsed.firstChild?.type.name).toBe(rejected ? 'enhancedCard' : 'plainCard');

		const renderer = createLightRenderer({ extensions, rawNodeViews: true });
		const session = renderer.enhance(target);
		expect(enhanced).toHaveBeenCalledTimes(rejected ? 1 : 0);
		expect(badge).toHaveBeenCalledTimes(1);
		expect(target.querySelector('[data-enhanced-badge]')).not.toBeNull();
		if (!rejected) expect(target.firstElementChild).toBe(source);
		expect(renderer.diagnostics).toEqual([]);
		session.destroy();
		expect(target.firstElementChild).toBe(source);
		expect(target.innerHTML).toBe('<x-card>text<x-badge></x-badge></x-card>');
	});
});
