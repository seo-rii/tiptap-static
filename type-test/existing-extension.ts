import { Node } from '@tiptap/core';

import { createStaticRenderer, type TiptapExtensionLike } from '../src/index.js';

const Existing = Node.create<{ nested: { enabled: boolean } }>({
	name: 'type-compatible',
	addOptions() {
		return { nested: { enabled: true } };
	},
	parseHTML() {
		return [{ tag: 'type-compatible' }];
	}
});

const structurallyAccepted: TiptapExtensionLike = Existing;
createStaticRenderer({ extensions: [Existing, structurallyAccepted] });
