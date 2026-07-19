<script lang="ts">
	import { getContext } from 'svelte';

	let { title }: { title: string } = $props();
	const nodeViewContext = getContext<{ onDragStart?: (event: DragEvent) => void }>(
		'TipTapNodeView'
	);
</script>

<strong
	data-static-child-component=""
	data-node-view-context={String(typeof nodeViewContext?.onDragStart === 'function')}
>{title}</strong
>
