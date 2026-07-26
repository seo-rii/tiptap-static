# Contributing

Thank you for helping improve `tiptap-static`.

## Before you start

- Search existing issues before opening a new one.
- Use a public issue for bugs and feature proposals.
- Use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities.
- Discuss large API or architecture changes before investing in an implementation.

## Development setup

The project requires Node.js 22.12 or newer and the pnpm version declared in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
```

## Validation

Run the checks relevant to your change:

```sh
pnpm check
pnpm test
pnpm pack:check
```

Run `pnpm benchmark` when changing rendering, hydration, dependency boundaries, or bundle composition. Benchmark results are machine-dependent, so preserve the ratio and size budgets rather than committing generated reports.

Add a regression test for behavior changes. Framework integration changes should exercise the real Svelte, React, or Vue adapter where applicable. Keep editor-only Tiptap and ProseMirror imports out of runtime source files.

## Pull requests

- Keep each pull request focused.
- Explain the user-visible behavior and tradeoffs.
- List the exact validation commands you ran.
- Update documentation when changing a public API or security boundary.
- Do not commit generated `dist`, tarballs, coverage, or benchmark results.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
