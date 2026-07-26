# tiptap-static

[![npm version](https://img.shields.io/npm/v/tiptap-static.svg)](https://www.npmjs.com/package/tiptap-static)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Render read-only Tiptap HTML without creating an `Editor` or a ProseMirror schema. The library accepts the existing extension objects produced by `Node.create()`, `.extend()`, and `.configure()` through structural inspection; it has no runtime dependency on `@tiptap/core` or `@tiptap/pm`.

The package is pre-1.0. Its public API is tested and intended for production evaluation, but minor releases may still refine integration contracts.

The full entry point performs three jobs:

1. Inspect `parseHTML`, `addAttributes`, `addGlobalAttributes`, `renderHTML`, and `addNodeView` on the supplied extensions with Tiptap-compatible parent binding.
2. Sanitize the stored HTML, deriving simple custom tags and rendered attribute names from those extensions.
3. Replace matching elements with static NodeViews and recursively move their original content into `contentDOM`.

There are no `/svelte`, `/react`, or `/vue` entry points. Framework integration stays in the existing Tiptap adapter library and is exposed to this package through one versioned NodeView hook.

| Import | Purpose | Loaded module graph |
| --- | --- | --- |
| `tiptap-static/protocol` | Attach or inspect static NodeView hooks | None |
| `tiptap-static/hydrate` | Hydrate prepared static-node plans | Standalone; no extension inspector |
| `tiptap-static/light` | Enhance trusted HTML with static NodeViews | No sanitizer, Tiptap, or ProseMirror |
| `tiptap-static/sanitize` | Sanitize stored HTML from extension-derived rules | Includes `sanitize-html`; no NodeView engine |
| `tiptap-static` | Sanitize and enhance untrusted/stored HTML | Includes `sanitize-html` |

These are import/bundle boundaries. Because npm installs dependencies per package, `sanitize-html` is still installed with `tiptap-static`, but it is not loaded into `/protocol` or `/light` consumers.

The Svelte, React, and Vue adapters used by the integration suite are dev-only fixtures; the emitted runtime does not import them.

## Installation

```sh
pnpm add tiptap-static
```

```sh
npm install tiptap-static
```

The package does not install Tiptap or a framework adapter. Keep the matching Tiptap and Svelte, React, or Vue adapter versions in the editor application.

## Compatibility

- ESM only
- Node.js 22.12 or newer for server-side sanitization
- Modern browsers with standard DOM APIs for `/light` and `/hydrate`
- Tested against Tiptap 3.28, Svelte 5 with `svelte-tiptap` 3, React 19, and Vue 3

Framework packages are development-only integration fixtures, not peer or runtime dependencies. Other Tiptap 3 and adapter versions may work when they preserve the documented NodeView contracts.

`tiptap-static` is an independent project and is not affiliated with or endorsed by Tiptap.

## Sanitization only

Use the dedicated entry when a server or trusted application boundary only needs to sanitize stored HTML:

```ts
import { sanitizeTiptapHTML } from 'tiptap-static/sanitize';

const safeHTML = sanitizeTiptapHTML(untrustedHTML, extensions, {
  allowedIframeHostnames: ['media.example.com']
});
```

This entry does not load the NodeView enhancement engine. Active content still requires explicit tag and attribute opt-in.

## Prepared hydration

Use the prepared entry for the smallest read-only browser chunk. Unlike `createLightRenderer`, it does not inspect Tiptap extension objects or provide a raw NodeView compatibility fallback. A dependency-free static declaration supplies the already parsed attributes, node shape, content location, and framework hook:

```ts
import { createHydrator, defineStaticNode } from 'tiptap-static/hydrate';
import { createStaticNodeViewRuntimeHook } from 'tiptap-static/protocol';
import CardComponent from './Card.svelte';
import {
  FRAMEWORK_STATIC_RUNTIME,
  frameworkStaticRuntime
} from './framework-static-runtime';

export const CardStatic = defineStaticNode({
  name: 'tiptap-card',
  rules: [
    {
      selector: 'tiptap-card',
      parse(element) {
        const title = element.getAttribute('title') ?? '';
        return {
          attrs: { title },
          HTMLAttributes: { title }
        };
      }
    }
  ],
  type: { isLeaf: false, spec: { content: 'block*' } },
  nodeView: createStaticNodeViewRuntimeHook(FRAMEWORK_STATIC_RUNTIME, {
    component: CardComponent
  })
});

const readOnly = createHydrator({
  nodes: [CardStatic],
  nodeViewRuntimes: [frameworkStaticRuntime]
});

const session = readOnly.mount(element, trustedSanitizedHTML);
```

`rules` are evaluated in node and rule order. A rule's `parse()` produces the exact `attrs` and rendered `HTMLAttributes` passed to the component; the prepared runtime deliberately does not repeat Tiptap defaulting, coercion, or `renderHTML` inference. `contentElement` can select a nested source such as `code` inside `pre`. `type.isLeaf` is explicit, while `isInline`, `isAtom`, and `spec` supply the remaining NodeView contract.

The plan must live in a module that does not import `@tiptap/core`, ProseMirror, or an editor-only framework adapter. The editor module can dynamically import Tiptap and build its `Node.create()` extension from the same shared constants. Passing `extension` in a plan preserves object identity for migrations, but omitting it is what lets the read-only chunk stay dependency-free.

Like `/light`, `/hydrate` trusts `mount()` and `session.update()` input. Sanitize stored or user-controlled HTML at a trusted server/editor boundary before loading the browser hydrator.

## Usage

```ts
import { createStaticRenderer } from 'tiptap-static';
import Card from './extensions/card';
import Collapsable from './extensions/collapsable';
import File from './extensions/file';

const readOnly = createStaticRenderer({
  extensions: [Card.configure({ upload: 'board' }), Collapsable, File],
  sanitize: {
    // Active content is never inferred automatically.
    allowedTags: ['embed'],
    allowedAttributes: {
      embed: ['src', 'type', 'width', 'height']
    },
    attributeValidators: {
      'tiptap-card': {
        background: value =>
          value.startsWith('#') || value.startsWith('linear-gradient(')
      }
    }
  }
});

const session = readOnly.mount(element, storedHTML);

// Sanitizes again, destroys the old NodeViews, and mounts the new tree.
session.update(nextHTML);

// Destroys NodeViews from child to parent and restores sanitized static HTML.
session.destroy();
```

`enhance(element)` is available when the element already contains trusted, sanitized HTML. `sanitize(html)` can also be used independently during SSR; DOM enhancement only runs in the browser.

## Light runtime

Use the light entry when HTML was already sanitized at a trusted boundary:

```ts
import { createLightRenderer } from 'tiptap-static/light';

const readOnly = createLightRenderer({
  extensions: [Card, Collapsable, File],
  nodeViewRuntimes: [frameworkStaticRuntime]
});

const session = readOnly.mount(element, trustedSanitizedHTML);
session.update(nextTrustedSanitizedHTML);
```

`createLightRenderer` never sanitizes `mount()` or `session.update()` input. Do not pass user-controlled or merely stored HTML to it unless the content was sanitized elsewhere. It disables raw NodeView fallback by default; set `rawNodeViews: true` only for a deliberate compatibility migration. Prefer `/hydrate` once an adapter and application expose dependency-free static plans.

The full and light renderers use the compatibility enhancement engine; `/hydrate` uses its smaller prepared-plan engine. All three share target ownership, so a new session takes ownership from the previous session and `destroy()` restores the original enhanced nodes rather than recreating them with `innerHTML`.

## Existing NodeViews

The current `svelte-tiptap@3.0.1` `SvelteNodeViewRenderer` works through the full renderer's read-only compatibility facade. This path is covered by an integration test using its real `NodeViewWrapper` and `NodeViewContent` components.

Compatibility fallback supplies the subset commonly read by NodeViews:

- `editor.options.editable === false`, `isEditable`, `state.selection`, `on`, and `off`
- read-only command and chain proxies
- `extensionManager.attributes` and `extensionStorage`
- `node.attrs`, `textContent`, `type.spec`, `isLeaf`, `isAtom`, and `content`
- `view`, `getPos`, decorations, and rendered `HTMLAttributes`

It is deliberately not a fake ProseMirror editor. A NodeView that dispatches transactions or requires a real schema/view is left as sanitized source HTML when mounting fails. Set `rawNodeViews: false` to allow only the lightweight hook. The light entry already uses that setting by default.

## Adapter hook for Svelte, React, and Vue

Adapter libraries can attach a lightweight mount implementation directly to the renderer returned by their existing `NodeViewRenderer` function:

```ts
import { setStaticNodeViewHook } from 'tiptap-static/protocol';

function FrameworkNodeViewRenderer(component) {
  const renderer = props => createEditorNodeView(component, props);

  return setStaticNodeViewHook(renderer, props => {
    const mounted = mountFrameworkComponent(component, props);

    return {
      dom: mounted.dom,
      contentDOM: mounted.contentDOM,
      destroy: mounted.destroy
    };
  });
}
```

The underlying identity is `Symbol.for('@tiptap-static/node-view-renderer/v1')`, so duplicate package installations still agree on the hook. A hook always wins over raw fallback; a failed hook is not retried as a raw NodeView because that could mount a component twice.

The hook returns the same framework-neutral DOM lifecycle for Svelte, React, and Vue. The adapter remains responsible for its own `mount`/`unmount`, React root, or Vue app lifecycle.

When the extension declaration must stay separate from the framework runtime, attach an opaque descriptor instead:

```ts
import { setStaticNodeViewRuntime } from 'tiptap-static/protocol';

export const FRAMEWORK_STATIC_RUNTIME = Symbol.for(
  'framework-adapter/static-node-view-runtime/v1'
);

function FrameworkNodeViewRenderer(component, options) {
  const editorRenderer = props => createEditorNodeView(component, props, options);

  return setStaticNodeViewRuntime(
    editorRenderer,
    FRAMEWORK_STATIC_RUNTIME,
    { component, options }
  );
}

export const frameworkStaticRuntime = {
  key: FRAMEWORK_STATIC_RUNTIME,
  mount({ value, props }) {
    const mounted = mountFrameworkComponent(value.component, props, value.options);
    return {
      dom: mounted.dom,
      contentDOM: mounted.contentDOM,
      destroy: mounted.destroy
    };
  }
};
```

Pass `frameworkStaticRuntime` through `nodeViewRuntimes`. A descriptor always wins over raw fallback. A missing or failing runtime preserves the source element and emits a diagnostic; the editor renderer is never retried, preventing a double mount. Runtime keys belong to adapter packages and should use `Symbol.for(...)` with a versioned adapter-specific name.

Static props include `selected: false` plus no-op `updateAttributes()` and `deleteNode()`, matching the read-only subset shared by the Svelte, React, and Vue NodeView component contracts.

## Sanitizer policy

Automatic inference is intentionally conservative:

- Simple selectors such as `tiptap-card` and `pre[data-kind]` contribute their tag. Selector-required attributes, classes, and IDs still need explicit narrow sanitizer rules.
- `rendered !== false` attributes contribute their serialized name. Attribute-level `renderHTML` is probed once to discover mappings such as `study` to `data-study`.
- Global attributes are applied to the target extension's parsed tags.
- Complex selectors, style-only rules, and ProseMirror-context rules emit diagnostics and require explicit sanitizer configuration.
- `script`, `style`, `on*`, and `srcdoc` are denied. Protocol-relative URLs are denied by default.
- `iframe`, `embed`, and `object` require explicit opt-in. Define hostname and custom value validators as appropriate.
- Inline `style` is not inferred. Use narrow `allowedStyles` rules if it is genuinely needed.

Attribute names are not value policies. If a component interprets an opaque attribute such as `background`, `data-url`, or an embed identifier as CSS or a URL, validate it with `attributeValidators`.

## What “no Tiptap dependency” means

The `/protocol` output has no runtime imports. The transitive `/light` output excludes `sanitize-html`, Tiptap, and ProseMirror. Only the full root entry loads the sanitizer. Passing an already-created extension object does not make this library load Tiptap.

However, importing today's application extension module may itself load `@tiptap/core`, ProseMirror, syntax highlighters, and its framework adapter before the object reaches this library. For the smallest read-only chunk, the producer modules must also have a light path: adapter libraries can implement the static hook without runtime editor imports, and heavy editor-only options/plugins should be moved behind the dynamically imported editor boundary.

The raw compatibility fallback proves that existing objects are usable. It cannot retroactively remove modules that the application already imported to create those objects.

## Verified behavior

The test suite covers:

- real Tiptap 3.28.0 `Node.create().extend().configure()` and `Mark.create()` objects
- inherited fields, defaults, global attributes, rule priorities, and duplicate detection
- nested NodeViews and child-first destruction
- CodeBlock's `pre > code > 0` serialization hole
- the real `svelte-tiptap@3.0.1` renderer compatibility fallback
- the same extension objects rendered through real Tiptap `Editor`/`EditorContent` and `/light`, comparing Svelte, React, and Vue component output without invoking the raw editor renderer in light mode
- the upstream svelte-tiptap leaf/atom and editable-content shapes, plus empty containers, siblings, ordinary framework child components, and recursively nested NodeViews
- real `svelte-tiptap`, `@tiptap/react`, and `@tiptap/vue-3` Wrapper/Content components through `/light` and `/hydrate`, including reactive updates, nested content, context, framework unmount, and source-DOM restoration
- three-way real Editor, `/light`, and `/hydrate` parity for deep nested NodeViews, leaf/atom nodes, mapped attributes, and explicit content holes
- direct-hook and descriptor-runtime precedence, hook-only mode, and lifecycle cleanup
- sanitizer-free light input, full-renderer sanitization, and atomic failed updates
- original DOM node/listener restoration after enhancement
- active content, URL schemes, event attributes, mapped attributes, and custom validators
- emitted `/protocol` and `/light` dependency-graph boundaries

## Tiptap comparison benchmarks

Run the complete comparison locally with:

```sh
pnpm benchmark
```

The command builds the package, writes reports under the ignored `benchmark-results/` directory, and fails when a budget in `benchmark/budgets.json` is exceeded. `pnpm benchmark:render` and `pnpm benchmark:size` run the individual comparisons.

The render benchmark gives the real Tiptap `Editor`, `createLightRenderer()`, and `createHydrator()` the same nested HTML and NodeView mount implementation. Tiptap and `/light` share extension objects, while `/hydrate` receives an equivalent prepared plan. Before timing, it validates the mounted NodeView count and compares the exact nested NodeView output. It then warms all paths, cycles through all six execution orders, and records 30 samples of six synchronous mounts. Component creation, DOM validation, and teardown happen identically around all paths; only synchronous mount is timed. CI gates use paired median ratios rather than absolute milliseconds because shared-runner hardware changes absolute timings.

The bundle benchmark uses the same pinned esbuild configuration for all three browser ESM entry points:

- `tiptap-static/light` exporting `createLightRenderer`
- `tiptap-static/hydrate` exporting `createHydrator`
- `@tiptap/core` exporting `Editor`

It minifies the complete dependency graphs without externals, repeats each build to prove byte-for-byte determinism, and compares raw and gzip sizes. The hydrate gate also rejects any accidental import of the compatibility engine, extension inspector, sanitizer, Tiptap, or ProseMirror. Framework code and application extensions are excluded from all bundles, so the result isolates the runtime choice and gives Tiptap the conservative baseline.

GitHub Actions runs type checks, all tests, package validation, render performance, and bundle-size budgets on Node 22.12. Each comparison run is written to the Job Summary and retained as a `benchmark-results` artifact containing JSON and Markdown reports.

Run `pnpm test`, `pnpm check`, `pnpm pack:check`, and `pnpm benchmark` before publishing.

## Contributing

Bug reports and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and project expectations.

## Security

Do not report vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md) to send a private report.

## License

Released under the [MIT License](LICENSE).
