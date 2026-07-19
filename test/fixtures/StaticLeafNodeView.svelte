<script lang="ts">
	import { NodeViewWrapper } from 'svelte-tiptap';

	import StaticNodeLabel from './StaticNodeLabel.svelte';

	let {
		node,
		editor,
		selected = false,
		updateAttributes
	}: {
		node: { attrs: Record<string, unknown> };
		editor: any;
		selected?: boolean;
		updateAttributes?: (attributes?: Record<string, unknown>) => void;
	} = $props();
</script>

<NodeViewWrapper
	as="section"
	data-parity-node-view="svelte"
	data-real-svelte-leaf-node-view=""
	data-editable={String(editor.options.editable)}
	data-static-selected={String(selected)}
>
	<StaticNodeLabel title={String(node.attrs.title ?? '')} />
	<button
		data-static-count=""
		onclick={() => updateAttributes?.({ count: Number(node.attrs.count ?? 0) + 1 })}
	>
		count:{String(node.attrs.count ?? 0)}
	</button>
</NodeViewWrapper>
