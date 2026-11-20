# Chief on Cloudflare Pages

Site: https://chiefai.pages.dev (not `chgiefai.pages.dev`).

Cloudflare Pages Git build settings:
- Framework: None
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: repository root

The root `functions/api/[[path]].js` supplies `/api/health` and `/api/chat`.
The build copies only public assets into `dist`. Do not move `functions` into `dist`.
Existing root-directory static deployments also remain supported.

Set `FIREWORKS_API_KEY` as a secret in the Pages project's production environment,
then redeploy. Never commit it or put it in browser JavaScript.
Optional `FIREWORKS_MODEL` overrides the default serverless model
`accounts/fireworks/models/glm-5p3-flash`. The previous Qwen3 8B model requires
a dedicated deployment and is not available on Fireworks' shared serverless API.
No dedicated GPU deployment is created by this website.

The AI requests use Fireworks account credits; availability depends on that account.
Health checks show whether the key is configured, not whether credits remain or
the provider accepted the key. A successful chat confirms the actual connection.

Run `npm test` and `npm run build` before pushing. Cloudflare's Git integration
deploys changes pushed to its configured production branch.
