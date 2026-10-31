## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

<!-- balsa-ui-agent-context:start -->
## Balsa UI

- Before writing common controls or surfaces, run `npx balsa-ui@latest search "<intent>"`, then read only the selected `.balsa/specs/components/<name>.json`.
- Install matching items with `npx balsa-ui@latest add <name>` before implementing the interface. Do not rebuild a Balsa-covered control with raw HTML and CSS.
- The specification is sufficient for normal composition. Inspect installed component source only when changing its behavior.
- Use semantic Balsa tokens and preserve component accessibility behavior and typed APIs.
- For new templates, showcases, blocks, or visually driven pages, use `$balsa-template-design` with `$balsa-ui` before coding. The companion skill is installed under `.agents/skills/`.
- Treat installed files as application source. Never use `--force` without reviewing local differences.
- Validate application changes with the repository's existing lint, test, typecheck, and build commands.
<!-- balsa-ui-agent-context:end -->
