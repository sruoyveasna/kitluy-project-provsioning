# scripts/development

Reserved for development scripts. Empty at bootstrap — scripts are added with the
milestones that need them and documented in PROJECT_HOME.md.

## Development stack after a reboot

`pnpm dev:stack:up` starts the `kitluy-fresh` stack the Pi images register
against and its host services, then prints their health; `pnpm dev:stack:health`
prints the health only; `pnpm dev:stack:edge-runtime` recreates the edge runtime
on the repository's `supabase/functions`. See
`00_AI_HANDOFF/edge-platform/57_DEV_STACK_DURABILITY.md`.
