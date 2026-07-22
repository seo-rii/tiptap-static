import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(benchmarkDirectory, '..');

function installDOM() {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', {
		pretendToBeVisual: true,
		url: 'https://benchmark.invalid/'
	});
	const { window } = dom;
	const values = {
		window,
		document: window.document,
		navigator: window.navigator,
		Node: window.Node,
		Element: window.Element,
		HTMLElement: window.HTMLElement,
		Text: window.Text,
		DocumentFragment: window.DocumentFragment,
		DOMParser: window.DOMParser,
		DOMRect: window.DOMRect,
		MutationObserver: window.MutationObserver,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		KeyboardEvent: window.KeyboardEvent,
		MouseEvent: window.MouseEvent,
		getComputedStyle: window.getComputedStyle.bind(window),
		getSelection: window.getSelection.bind(window),
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
	};

	for (const [name, value] of Object.entries(values)) {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value
		});
	}

	return dom;
}

function percentile(values, fraction) {
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
	return sorted[index];
}

function round(value, digits = 3) {
	return Number(value.toFixed(digits));
}

function summarize(samples) {
	const medianMs = percentile(samples, 0.5);
	return {
		p25Ms: round(percentile(samples, 0.25)),
		medianMs: round(medianMs),
		p75Ms: round(percentile(samples, 0.75)),
		p95Ms: round(percentile(samples, 0.95)),
		minMs: round(Math.min(...samples)),
		maxMs: round(Math.max(...samples)),
		operationsPerSecond: round(1000 / medianMs, 1)
	};
}

function readPositiveInteger(name, fallback) {
	const configured = process.env[name];
	if (configured === undefined) return fallback;
	const value = Number(configured);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer.`);
	}
	return value;
}

function makeHTML(outerCards) {
	return Array.from(
		{ length: outerCards },
		(_, index) =>
			`<benchmark-card title="outer-${index}"><p>before ${index}</p><benchmark-card title="inner-${index}"><p>inside ${index}</p></benchmark-card><p>after ${index}</p></benchmark-card>`
	).join('');
}

function createNodeViewDOM(props) {
	const dom = document.createElement('article');
	dom.dataset.benchmarkNodeView = '';
	dom.dataset.title = String(props.node.attrs.title ?? '');
	const label = document.createElement('strong');
	label.textContent = String(props.node.attrs.title ?? '');
	const contentDOM = document.createElement('section');
	contentDOM.dataset.benchmarkContent = '';
	dom.append(label, contentDOM);
	return { dom, contentDOM };
}

function measureBatch(createRender, batchSize, expectedNodeViews) {
	let elapsed = 0;
	for (let index = 0; index < batchSize; index += 1) {
		const start = performance.now();
		const rendered = createRender();
		elapsed += performance.now() - start;
		const nodeViewCount = rendered.target.querySelectorAll(
			'[data-benchmark-node-view]'
		).length;
		if (nodeViewCount !== expectedNodeViews) {
			rendered.destroy();
			throw new Error(
				`Expected ${expectedNodeViews} NodeViews, received ${nodeViewCount}.`
			);
		}
		rendered.destroy();
	}
	return elapsed / batchSize;
}

export async function runRenderBenchmark() {
	const dom = installDOM();
	try {
		const [
			{ Editor, Node },
			{ createLightRenderer },
			{ createHydrator },
			{ createStaticNodeViewHook, setStaticNodeViewHook }
		] =
			await Promise.all([
				import('@tiptap/core'),
				import('../dist/light.js'),
				import('../dist/hydrate.js'),
				import('../dist/protocol.js')
			]);
		const [budgets, packageManifest] = await Promise.all([
			readFile(resolve(benchmarkDirectory, 'budgets.json'), 'utf8').then(JSON.parse),
			readFile(resolve(projectRoot, 'package.json'), 'utf8').then(JSON.parse)
		]);
		const outerCards = readPositiveInteger(
			'TIPTAP_STATIC_BENCHMARK_OUTER_CARDS',
			budgets.render.outerCards
		);
		const warmupIterations = readPositiveInteger(
			'TIPTAP_STATIC_BENCHMARK_WARMUP',
			budgets.render.warmupIterations
		);
		const sampleCount = readPositiveInteger(
			'TIPTAP_STATIC_BENCHMARK_SAMPLES',
			budgets.render.samples
		);
		const batchSize = readPositiveInteger(
			'TIPTAP_STATIC_BENCHMARK_BATCH',
			budgets.render.batchSize
		);
		const html = makeHTML(outerCards);
		const expectedNodeViews = outerCards * 2;
		let rawRendererCalls = 0;
		let staticHookCalls = 0;

		const TestDocument = Node.create({
			name: 'doc',
			topNode: true,
			content: 'block*'
		});
		const TestText = Node.create({
			name: 'text',
			group: 'inline'
		});
		const TestParagraph = Node.create({
			name: 'paragraph',
			group: 'block',
			content: 'inline*',
			parseHTML() {
				return [{ tag: 'p' }];
			},
			renderHTML() {
				return ['p', 0];
			}
		});
		const staticMount = (props) => {
			staticHookCalls += 1;
			return createNodeViewDOM(props);
		};
		const BenchmarkCard = Node.create({
			name: 'benchmarkCard',
			group: 'block',
			content: 'block*',
			addAttributes() {
				return { title: { default: '' } };
			},
			parseHTML() {
				return [{ tag: 'benchmark-card' }];
			},
			renderHTML({ HTMLAttributes }) {
				return ['benchmark-card', HTMLAttributes, 0];
			},
			addNodeView() {
				const editorRenderer = (props) => {
					rawRendererCalls += 1;
					return createNodeViewDOM(props);
				};
				return setStaticNodeViewHook(editorRenderer, staticMount);
			}
		});
		const extensions = [TestDocument, TestText, TestParagraph, BenchmarkCard];
		const lightRenderer = createLightRenderer({ extensions });
		const hydrator = createHydrator({
			nodes: [
				{
					name: 'benchmarkCard',
					rules: [
						{
							selector: 'benchmark-card',
							parse(element) {
								const title = element.getAttribute('title') ?? '';
								return { attrs: { title }, HTMLAttributes: { title } };
							}
						}
					],
					type: { isLeaf: false, spec: { content: 'block*' } },
					nodeView: createStaticNodeViewHook(staticMount)
				}
			]
		});

		const renderTiptap = () => {
			const target = document.createElement('div');
			const editor = new Editor({
				element: target,
				extensions,
				content: html,
				editable: false,
				injectCSS: false
			});
			return {
				target,
				destroy() {
					editor.destroy();
					target.remove();
				}
			};
		};
		const renderStatic = () => {
			const target = document.createElement('div');
			const session = lightRenderer.mount(target, html);
			return {
				target,
				destroy() {
					session.destroy();
					target.remove();
				}
			};
		};
		const renderHydrate = () => {
			const target = document.createElement('div');
			const session = hydrator.mount(target, html);
			return {
				target,
				destroy() {
					session.destroy();
					target.remove();
				}
			};
		};

		const renderers = {
			tiptap: renderTiptap,
			light: renderStatic,
			hydrate: renderHydrate
		};
		const projections = {};
		for (const [name, createRender] of Object.entries(renderers)) {
			const rawCallsBeforeProbe = rawRendererCalls;
			const staticCallsBeforeProbe = staticHookCalls;
			const rendered = createRender();
			try {
				const nodeViews = [
					...rendered.target.querySelectorAll('[data-benchmark-node-view]')
				];
				if (nodeViews.length !== expectedNodeViews) {
					throw new Error(
						`Expected ${expectedNodeViews} NodeViews, received ${nodeViews.length}.`
					);
				}
				projections[name] = nodeViews
					.filter(
						(nodeView) =>
							!nodeView.parentElement?.closest('[data-benchmark-node-view]')
					)
					.map((nodeView) => nodeView.outerHTML);
			} finally {
				rendered.destroy();
			}
			if (name === 'tiptap') {
				if (rawRendererCalls <= rawCallsBeforeProbe) {
					throw new Error('The Tiptap benchmark did not invoke the editor NodeView renderer.');
				}
			} else if (
				rawRendererCalls !== rawCallsBeforeProbe ||
				staticHookCalls <= staticCallsBeforeProbe
			) {
				throw new Error(`The ${name} benchmark did not stay on its static NodeView hook.`);
			}
		}
		if (
			JSON.stringify(projections.light) !== JSON.stringify(projections.tiptap) ||
			JSON.stringify(projections.hydrate) !== JSON.stringify(projections.tiptap)
		) {
			throw new Error('The benchmark renderers produced different nested NodeView output.');
		}
		const orders = [
			['tiptap', 'light', 'hydrate'],
			['tiptap', 'hydrate', 'light'],
			['light', 'tiptap', 'hydrate'],
			['light', 'hydrate', 'tiptap'],
			['hydrate', 'tiptap', 'light'],
			['hydrate', 'light', 'tiptap']
		];
		for (let index = 0; index < warmupIterations; index += 1) {
			for (const name of orders[index % orders.length]) {
				measureBatch(renderers[name], 1, expectedNodeViews);
			}
		}

		const samples = { tiptap: [], light: [], hydrate: [] };
		for (let sample = 0; sample < sampleCount; sample += 1) {
			for (const name of orders[sample % orders.length]) {
				samples[name].push(measureBatch(renderers[name], batchSize, expectedNodeViews));
			}
		}

		const tiptap = summarize(samples.tiptap);
		const light = summarize(samples.light);
		const hydrate = summarize(samples.hydrate);
		const tiptapToStaticMedianRatio = tiptap.medianMs / light.medianMs;
		const pairedRatios = samples.tiptap.map(
			(tiptapSample, index) => tiptapSample / samples.light[index]
		);
		const pairedTiptapToHydrateRatios = samples.tiptap.map(
			(tiptapSample, index) => tiptapSample / samples.hydrate[index]
		);
		const pairedLightToHydrateRatios = samples.light.map(
			(lightSample, index) => lightSample / samples.hydrate[index]
		);
		const pairedMedianRatio = percentile(pairedRatios, 0.5);
		const pairedTiptapToHydrateMedianRatio = percentile(
			pairedTiptapToHydrateRatios,
			0.5
		);
		const pairedLightToHydrateMedianRatio = percentile(
			pairedLightToHydrateRatios,
			0.5
		);
		const checks = [
			{
				id: 'render.paired-median-ratio.min',
				actual: round(pairedMedianRatio, 4),
				limit: budgets.render.minTiptapToStaticMedianRatio,
				operator: '>=',
				passed: pairedMedianRatio >= budgets.render.minTiptapToStaticMedianRatio
			},
			{
				id: 'render.tiptap-to-hydrate.paired-median-ratio.min',
				actual: round(pairedTiptapToHydrateMedianRatio, 4),
				limit: budgets.render.minTiptapToHydrateMedianRatio,
				operator: '>=',
				passed:
					pairedTiptapToHydrateMedianRatio >= budgets.render.minTiptapToHydrateMedianRatio
			},
			{
				id: 'render.light-to-hydrate.paired-median-ratio.min',
				actual: round(pairedLightToHydrateMedianRatio, 4),
				limit: budgets.render.minLightToHydrateMedianRatio,
				operator: '>=',
				passed:
					pairedLightToHydrateMedianRatio >= budgets.render.minLightToHydrateMedianRatio
			}
		];
		const result = {
			schemaVersion: 1,
			benchmark: 'render-performance',
			generatedAt: new Date().toISOString(),
			environment: {
				node: process.version,
				platform: process.platform,
				arch: process.arch,
				cpu: cpus()[0]?.model ?? 'unknown',
				ci: process.env.CI === 'true'
			},
			versions: {
				tiptapStatic: packageManifest.version,
				tiptapCore: packageManifest.devDependencies['@tiptap/core'],
				jsdom: packageManifest.devDependencies.jsdom
			},
			methodology: {
				measuredPhase: 'synchronous mount; destroy runs after each timed operation',
				alternatingOrder: true,
				balancedSixWayOrder: true,
				lightRendererPreparedOnce: true,
				hydratorPreparedOnce: true,
				tiptapEditorCreatedPerRender: true,
				sameExtensionObjectForTiptapAndLight: true,
				equivalentPreparedPlanForHydrate: true,
				sameNodeViewMountImplementation: true,
				sameHTML: true,
				nestedNodeViewOutputCompared: true
			},
			workload: {
				outerCards,
				nodeViews: expectedNodeViews,
				htmlBytes: Buffer.byteLength(html),
				warmupIterations,
				samples: sampleCount,
				batchSize
			},
			results: {
				tiptapEditor: tiptap,
				tiptapStaticLight: light,
				tiptapStaticHydrate: hydrate
			},
			comparison: {
				tiptapToStaticMedianRatio: round(tiptapToStaticMedianRatio, 4),
				pairedMedianRatio: round(pairedMedianRatio, 4),
				pairedP25Ratio: round(percentile(pairedRatios, 0.25), 4),
				pairedP75Ratio: round(percentile(pairedRatios, 0.75), 4),
				staticSavingsPercent: round((1 - 1 / pairedMedianRatio) * 100, 2),
				pairedTiptapToHydrateMedianRatio: round(pairedTiptapToHydrateMedianRatio, 4),
				pairedTiptapToHydrateP25Ratio: round(
					percentile(pairedTiptapToHydrateRatios, 0.25),
					4
				),
				pairedTiptapToHydrateP75Ratio: round(
					percentile(pairedTiptapToHydrateRatios, 0.75),
					4
				),
				pairedLightToHydrateMedianRatio: round(pairedLightToHydrateMedianRatio, 4),
				pairedLightToHydrateP25Ratio: round(
					percentile(pairedLightToHydrateRatios, 0.25),
					4
				),
				pairedLightToHydrateP75Ratio: round(
					percentile(pairedLightToHydrateRatios, 0.75),
					4
				),
				hydrateSavingsPercent: round(
					(1 - 1 / pairedTiptapToHydrateMedianRatio) * 100,
					2
				)
			},
			checks,
			passed: checks.every((check) => check.passed)
		};

		return result;
	} finally {
		dom.window.close();
	}
}

export function renderPerformanceMarkdown(result) {
	const status = result.passed ? 'PASS' : 'FAIL';
	return [
		'## Render performance',
		'',
		'Identical nested HTML and the same NodeView mount implementation are rendered in jsdom. Tiptap and /light share extension objects; /hydrate uses an equivalent prepared plan. Timings cover synchronous mount only; teardown happens after every sample.',
		'',
		'| Renderer | Median | p95 | Operations/s |',
		'| --- | ---: | ---: | ---: |',
		`| Tiptap Editor | ${result.results.tiptapEditor.medianMs} ms | ${result.results.tiptapEditor.p95Ms} ms | ${result.results.tiptapEditor.operationsPerSecond} |`,
		`| tiptap-static/light | ${result.results.tiptapStaticLight.medianMs} ms | ${result.results.tiptapStaticLight.p95Ms} ms | ${result.results.tiptapStaticLight.operationsPerSecond} |`,
		`| tiptap-static/hydrate | ${result.results.tiptapStaticHydrate.medianMs} ms | ${result.results.tiptapStaticHydrate.p95Ms} ms | ${result.results.tiptapStaticHydrate.operationsPerSecond} |`,
		'',
		`Paired Tiptap/light median ratio: **${result.comparison.pairedMedianRatio}×** (budget ≥ ${result.checks[0].limit}×)`,
		`Paired Tiptap/hydrate median ratio: **${result.comparison.pairedTiptapToHydrateMedianRatio}×** (budget ≥ ${result.checks[1].limit}×)`,
		`Paired light/hydrate median ratio: **${result.comparison.pairedLightToHydrateMedianRatio}×** (budget ≥ ${result.checks[2].limit}×) — **${status}**`,
		''
	].join('\n');
}

async function main() {
	const result = await runRenderBenchmark();
	console.log(renderPerformanceMarkdown(result));
	if (!result.passed) process.exitCode = 1;
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === executedPath) await main();
