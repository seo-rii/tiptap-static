# Security Policy

## Supported versions

Security fixes are provided for the latest published version. Before 1.0, a fix may ship together with a minor API adjustment when that is necessary to close the vulnerability safely.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/seo-rii/tiptap-static/security/advisories/new) and include:

- the affected version and import path;
- a minimal reproduction or proof of concept;
- the expected and observed security boundary;
- the potential impact;
- any mitigation you have already tested.

Reports will be acknowledged and investigated on a best-effort basis. Please allow time for a fix and coordinated release before public disclosure.

This package handles untrusted HTML, so reports involving sanitizer inference, URL handling, active content, or DOM lifecycle boundaries are especially useful.
