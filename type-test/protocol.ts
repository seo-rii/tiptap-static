import {
	STATIC_NODE_VIEW as ROOT_STATIC_NODE_VIEW,
	createHydrator,
	createLightRenderer,
	createStaticNodeViewRuntimeHook,
	defineStaticNode,
	setStaticNodeViewRuntime as setRootRuntime,
	type StaticNodeViewRuntime
} from '../src/index.js';
import type {
	HydratorOptions as DirectHydratorOptions,
	StaticHydrationMatch,
	StaticHydrationNodeType,
	StaticHydrationRule,
	StaticHydrator as DirectStaticHydrator,
	StaticNodePlan as DirectStaticNodePlan
} from '../src/hydrate.js';
import {
	STATIC_NODE_VIEW as PROTOCOL_STATIC_NODE_VIEW,
	setStaticNodeViewRuntime,
	type StaticNodeViewRenderer
} from '../src/protocol.js';

const rootSymbol: typeof ROOT_STATIC_NODE_VIEW = PROTOCOL_STATIC_NODE_VIEW;
const protocolSymbol: typeof PROTOCOL_STATIC_NODE_VIEW = ROOT_STATIC_NODE_VIEW;
const rootSetter: typeof setRootRuntime = setStaticNodeViewRuntime;

const descriptor = {
	component: { name: 'Card' },
	options: { context: new Map<string, unknown>() }
};
const runtimeKey = Symbol.for('type-test-adapter/static-runtime/v1');
const renderer = (() => ({ dom: document.createElement('div') })) as StaticNodeViewRenderer;
const tagged = setStaticNodeViewRuntime(renderer, runtimeKey, descriptor);
const sameDescriptor: typeof descriptor = tagged[PROTOCOL_STATIC_NODE_VIEW].value;

const runtime: StaticNodeViewRuntime<typeof descriptor> = {
	key: runtimeKey,
	mount({ value, props }) {
		const componentName: string = value.component.name;
		const selected: false = props.selected;
		props.updateAttributes();
		props.deleteNode();
		return {
			dom: Object.assign(document.createElement('div'), {
				textContent: `${componentName}:${selected}`
			})
		};
	}
};

createLightRenderer({ extensions: [], nodeViewRuntimes: [runtime] });
const node = defineStaticNode({
	name: 'type-test-card',
	rules: [
		{
			selector: 'type-test-card',
			parse: (element) => ({
				attrs: { title: element.getAttribute('title') ?? '' },
				HTMLAttributes: { title: element.getAttribute('title') ?? '' }
			})
		}
	],
	type: { isLeaf: false, spec: { content: 'block*' } },
	nodeView: createStaticNodeViewRuntimeHook(runtimeKey, descriptor)
});
const directRule: StaticHydrationRule = node.rules[0];
const directMatch: StaticHydrationMatch = { attrs: { title: 'typed' } };
const directNodeType: StaticHydrationNodeType = node.type;
const directPlan: DirectStaticNodePlan = node;
const directOptions: DirectHydratorOptions = {
	nodes: [directPlan],
	nodeViewRuntimes: [runtime]
};
const directHydrator: DirectStaticHydrator = createHydrator(directOptions);

void rootSymbol;
void protocolSymbol;
void rootSetter;
void sameDescriptor;
void directRule;
void directMatch;
void directNodeType;
void directHydrator;
