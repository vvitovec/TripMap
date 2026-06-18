# AGENTS.md

- Always commit and push changes to GitHub.
- Keep commit messages short and light.
- Production is hosted on Baller at `baller:/srv/projects/TripMap`.
- Public traffic for `https://trip.vvitovec.com` is served through the `basev-platform` Cloudflare Tunnel to the Baller web service on port `8327`.
- The API is available at `https://trip-api.vvitovec.com` and through `/api/*` on the app domain.
- Deploy Baller with `pnpm deploy:baller`.
- The Vercel project `viktor-vitovecs-projects/tripmap` also has `trip.vvitovec.com` configured as a production alias.
