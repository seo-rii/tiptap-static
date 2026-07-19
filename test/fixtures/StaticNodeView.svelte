<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { NodeViewContent, NodeViewWrapper } from 'svelte-tiptap';

	import StaticNodeLabel from './StaticNodeLabel.svelte';

	let {
		node,
		editor,
		onStaticMount,
		onStaticDestroy,
		onStaticClick,
		selected = false,
		updateAttributes
	}: {
		node: { attrs: Record<string, unknown> };
		editor: any;
		onStaticMount?: () => void;
		onStaticDestroy?: () => void;
		onStaticClick?: () => void;
		selected?: boolean;
		updateAttributes?: (attributes?: Record<string, unknown>) => void;
	} = $props();
	let clicks = $state(0);

	onMount(() => {
		onStaticMount?.();
	});
	onDestroy(() => {
		onStaticDestroy?.();
	});
</script>

<NodeViewWrapper
	as="section"
	data-parity-node-view="svelte"
	data-real-svelte-node-view=""
	data-editable={String(editor.options.editable)}
	data-static-selected={String(selected)}
>
	<StaticNodeLabel title={String(node.attrs.title ?? '')} />
	<button
		data-static-click=""
		onclick={() => {
			clicks += 1;
			onStaticClick?.();
			updateAttributes?.({ ignored: true });
		}}
	>
		clicks:{clicks}
	</button>
	<NodeViewContent data-parity-content="" data-static-content="" />
</NodeViewWrapper>
