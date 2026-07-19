import {
	STATIC_NODE_VIEW as ROOT_STATIC_NODE_VIEW,
	createLightRenderer,
	setStaticNodeViewRuntime as setRootRuntime,
	type StaticNodeViewRuntime
} from '../src/index.js';
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

void rootSymbol;
void protocolSymbol;
void rootSetter;
void sameDescriptor;
