# GitHub Pages deployment contract

The repository owns only compact source, fictional fixtures, generated samples and reproducible test code. The workflow builds and deploys all static assets, including the469,927,196-byte adapted embedding model and13,836,895-byte detector, from pinned model downloads. No Git LFS and no external inference endpoint.

- Production Vite base: ./ (works at /litert-explorer/ and any repository name).
- Classic worker: ./wasm/inference-worker.js; its ../ base targets repository root.
- Emscripten WASM files are beside the worker under wasm/.
- Model, tokenizer and sample URLs are relative to repository root.
- Service Worker scope is the repository directory. Cache namespaces include its scope, avoiding other Pages projects on the same origin.
- CPU/WASM only, threads=false and jspi=false. No COOP/COEP response headers or SharedArrayBuffer required.
- Inputs stay in the browser. CSP connect-src is self. Only same-origin public asset GET requests are required during use; npm/CI retrieves dependencies and model bytes during build.
- Licenses and third-party notices are included in the deployed artifact under licenses/.
- Pages supports a maximum1GB published site, a10-minute deployment timeout and soft100GB/month bandwidth. verify:pages gates the artifact below900MiB; actual deployment and browser checks must still pass.
- GitHub Actions workflow uses official actions pinned to exact Git SHAs and the ephemeral default token, scoped to contents:read/pages:read for build and pages:write/id-token:write for deployment. No personal token or secrets are needed.

Before first push, enable Pages with build_type=workflow (or Settings → Pages → GitHub Actions). If source is pushed before Pages is configured, set the source and re-run the workflow. Do not claim success until the exact commit's deploy job and the live site's actual inference pass.

Saved run logs, audit JSON and evidence images are deliberately excluded from the public source.

Published behavior must be verified at the returned live Pages URL. Existing Node host tests prove model execution, not browser compatibility. See tests/browser.mjs and docs/verification.md for the distinction.

Official references (checked2026-10-12):
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
