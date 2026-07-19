import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(packageRoot, 'dist');

async function collectGraph(entry) {
	const pending = [resolve(distRoot, entry)];
	const modules = new Map();
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file || modules.has(file)) continue;
		const source = await readFile(file, 'utf8');
		modules.set(file, source);

		const specifiers = new Set();
		for (const pattern of [
			/\b(?:from|import\s*\()\s*['"](\.[^'"]+)['"]/g,
			/\bimport\s*['"](\.[^'"]+)['"]/g
		]) {
			for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
		}
		for (const specifier of specifiers) pending.push(resolve(dirname(file), specifier));
	}
	return modules;
}

test('protocol entry has no runtime imports and works without DOM globals', async () => {
	const graph = await collectGraph('protocol.js');
	assert.equal(graph.size, 1);
	const protocol = await import(pathToFileURL(resolve(distRoot, 'protocol.js')).href);
	const renderer = () => undefined;
	const value = { component: 'fixture' };
	protocol.setStaticNodeViewRuntime(renderer, Symbol.for('fixture/runtime/v1'), value);
	assert.equal(protocol.getStaticNodeViewHook(renderer).value, value);
});

test('light entry transitively excludes sanitizer, Tiptap, and ProseMirror', async () => {
	const graph = await collectGraph('light.js');
	const source = [...graph.values()].join('\n');
	assert.doesNotMatch(source, /sanitize-html|@tiptap\/|(?:^|['"])prosemirror-/m);
	assert.ok(![...graph.keys()].some((file) => file.endsWith('/sanitize.js')));
	await import(pathToFileURL(resolve(distRoot, 'light.js')).href);
});

test('root and protocol entries expose identical protocol bindings', async () => {
	const [root, protocol] = await Promise.all([
		import(pathToFileURL(resolve(distRoot, 'index.js')).href),
		import(pathToFileURL(resolve(distRoot, 'protocol.js')).href)
	]);
	assert.equal(root.STATIC_NODE_VIEW, protocol.STATIC_NODE_VIEW);
	assert.equal(root.setStaticNodeViewHook, protocol.setStaticNodeViewHook);
	assert.equal(root.setStaticNodeViewRuntime, protocol.setStaticNodeViewRuntime);
});

test('package exports point at emitted light and protocol declarations', async () => {
	const packageJSON = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
	assert.deepEqual(packageJSON.exports['./light'], {
		types: './dist/light.d.ts',
		import: './dist/light.js',
		default: './dist/light.js'
	});
	assert.deepEqual(packageJSON.exports['./protocol'], {
		types: './dist/protocol.d.ts',
		import: './dist/protocol.js',
		default: './dist/protocol.js'
	});
});
