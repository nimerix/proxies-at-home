# Oops, All Proxies client

See the [project README](../README.md) for setup, features, configuration and print instructions.

```sh
npm run dev        # Vite; /api goes to the Worker on 127.0.0.1:8787
npm run lint
npm test           # Vitest unit tests
npm run build      # TypeScript check and production bundle
```

Run the production browser tests from the repository root with `npm run test:e2e` after building the client. Layout, print output, import/export and persistence regressions live in `../tests/workspace.spec.ts`.
