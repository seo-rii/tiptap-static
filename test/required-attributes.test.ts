import { Extension, Node, getSchema } from '@tiptap/core';
import { DOMParser } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';

import { inspectExtensions } from '../src/extensions.js';
import { createLightRenderer } from '../src/light.js';
import type { StaticNodeViewProps, TiptapAttributeLike } from '../src/types.js';

const Document = Node.create({ name: 'doc', topNode: true, content: 'block*' });
const Text = Node.create({ name: 'text', group: 'inline' });

describe.each(['local', 'global'] as const)('%s required attributes', (scope) => {
	it.each([
		{ label: 'omitted default', attribute: { isRequired: true } },
		{ label: 'undefined default', attribute: { isRequired: true, default: undefined } },
		{ label: 'null default', attribute: { isRequired: true, default: null } },
		{ label: 'literal default', attribute: { isRequired: true, default: 'fallback' } },
		{ label: 'computed default', attribute: { isRequired: true, default: () => 'fallback' } }
	] satisfies Array<{ label: string; attribute: TiptapAttributeLike }>)('matches the official schema with $label', ({ attribute }) => {
		const captured = vi.fn(({ node }: StaticNodeViewProps) => {
			const dom = document.createElement('output');
			dom.textContent = String(node.attrs.token);
			return { dom };
		});
		const Card = Node.create({
			name: 'requiredCard',
			group: 'block',
			atom: true,
			addAttributes: () => scope === 'local' ? { token: attribute } : {},
			parseHTML: () => [{ tag: 'required-card' }],
			renderHTML: ({ HTMLAttributes }) => ['required-card', HTMLAttributes],
			addNodeView: () => captured as never
		});
		const Required = Extension.create({
			name: 'required',
			addGlobalAttributes: () => scope === 'global'
				? [{ types: ['requiredCard'], attributes: { token: attribute } }]
				: []
		});
		const extensions = [Document, Text, Card, Required];
		const schema = getSchema(extensions);
		expect(schema.nodes.requiredCard.hasRequiredAttrs()).toBe(true);
		expect(() => schema.nodes.requiredCard.create({})).toThrow('No value supplied for attribute token');
		const inspected = inspectExtensions(extensions).attributes.find(({ name }) => name === 'token');
		expect(inspected?.hasDefault).toBe(false);

		const target = document.createElement('div');
		target.innerHTML = '<required-card>preserved</required-card><required-card token="supplied"></required-card>';
		const missing = target.firstElementChild;
		const supplied = document.createElement('div');
		supplied.innerHTML = '<required-card token="supplied"></required-card>';
		const parsed = DOMParser.fromSchema(schema).parse(supplied);
		const renderer = createLightRenderer({ extensions, rawNodeViews: true });
		const session = renderer.enhance(target);

		expect(captured).toHaveBeenCalledTimes(1);
		expect(captured.mock.calls[0][0].node.attrs).toEqual(parsed.firstChild?.attrs);
		expect(target.firstElementChild).toBe(missing);
		expect(missing?.textContent).toBe('preserved');
		expect(renderer.diagnostics).toEqual([
			expect.objectContaining({ code: 'required-attribute-missing', extension: 'requiredCard' })
		]);
		session.destroy();
		expect(target.querySelectorAll('required-card')).toHaveLength(2);
	});
});
