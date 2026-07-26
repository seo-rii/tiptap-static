import { Mark, Node } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { inspectExtensions, resolveExtensionField } from '../src/extensions.js';
import type { TiptapExtensionLike } from '../src/types.js';

describe('extension inspection', () => {
	it('inspects real Tiptap marks separately from NodeView candidates', () => {
		const StaticMark = Mark.create({
			name: 'staticMark',
			addAttributes() {
				return { tone: { default: 'neutral' } };
			},
			parseHTML() {
				return [{ tag: 'static-mark' }];
			},
			renderHTML({ HTMLAttributes }) {
				return ['static-mark', HTMLAttributes, 0];
			}
		});

		const inspection = inspectExtensions([StaticMark]);

		expect(inspection.nodes).toEqual([]);
		expect(inspection.marks).toHaveLength(1);
		expect(inspection.marks[0]).toMatchObject({
			extension: StaticMark,
			attributes: [{ name: 'tone', attribute: { default: 'neutral' } }],
			rules: [{ selector: 'static-mark', tagName: 'static-mark' }]
		});
		expect(inspection.rules).toEqual([]);
	});

	it('evaluates configured Tiptap 3 options once per inspection', () => {
		let optionCalls = 0;
		const Base = Node.create({
			name: 'configured-card',
			group: 'block',
			content: 'block*',
			addOptions() {
				optionCalls += 1;
				return { label: 'base', nested: { first: true } };
			},
			parseHTML() {
				return [{ tag: 'configured-card' }];
			},
			renderHTML({ HTMLAttributes }) {
				return ['configured-card', HTMLAttributes, 0];
			}
		});
		const Configured = Base.extend({
			addOptions() {
				return { ...this.parent?.(), label: 'extended' };
			},
			addAttributes() {
				return { label: { default: this.options.label } };
			}
		}).configure({ label: 'configured', nested: { second: true } } as never);
		const beforeInspection = optionCalls;

		const inspection = inspectExtensions([Configured]);

		expect(optionCalls).toBe(beforeInspection + 1);
		expect(inspection.nodes[0].extension).toBe(Configured);
		expect(inspection.nodes[0].attributes[0]).toMatchObject({
			name: 'label',
			attribute: { default: 'configured' }
		});
		expect(Configured.options).toMatchObject({
			label: 'configured',
			nested: { first: true, second: true }
		});
	});

	it('binds inherited fields with the child context and lets null stop inheritance', () => {
		const parent: TiptapExtensionLike = {
			name: 'parent',
			options: {},
			storage: {},
			config: {
				field(this: { options: { value: string } }) {
					return this.options.value;
				}
			}
		};
		const child: TiptapExtensionLike = {
			name: 'child',
			parent,
			options: { value: 'configured' },
			storage: {},
			config: {
				field(this: { parent: () => string }) {
					return `child:${this.parent()}`;
				}
			}
		};

		const field = resolveExtensionField<() => string>(child, 'field', {
			options: child.options
		});
		expect(field()).toBe('child:configured');

		child.config.field = null;
		expect(resolveExtensionField(child, 'field', { options: child.options })).toBeNull();
	});

	it('reports duplicate names and rejects circular parent chains', () => {
		const first = { name: 'same', type: 'node', config: {} } satisfies TiptapExtensionLike;
		const second = { name: 'same', type: 'node', config: {} } satisfies TiptapExtensionLike;
		const inspection = inspectExtensions([first, second]);
		expect(inspection.diagnostics).toContainEqual(
			expect.objectContaining({ code: 'duplicate-extension', extension: 'same' })
		);

		first.parent = second;
		second.parent = first;
		expect(() => resolveExtensionField(first, 'missing')).toThrow(/Circular extension parent chain/);
	});

	it('flattens addExtensions and applies stable extension and rule priorities', () => {
		const low = {
			name: 'low',
			type: 'node',
			config: { priority: 10, parseHTML: () => [{ tag: 'x-low', priority: 80 }] }
		} satisfies TiptapExtensionLike;
		const high = {
			name: 'high',
			type: 'node',
			config: { priority: 200, parseHTML: () => [{ tag: 'x-high' }] }
		} satisfies TiptapExtensionLike;
		const kit = {
			name: 'kit',
			type: 'extension',
			config: { addExtensions: () => [low, high] }
		} satisfies TiptapExtensionLike;

		const inspection = inspectExtensions([kit]);
		expect(inspection.extensions.map((extension) => extension.name)).toEqual(['high', 'kit', 'low']);
		expect(inspection.rules.map((rule) => rule.selector)).toEqual(['x-low', 'x-high']);
	});
});
