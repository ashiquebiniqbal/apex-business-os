# Apex Business OS

Independent business operations application built with React, Vite, TypeScript, and Supabase.

## Local development

Requirements: Node.js 24+ and npm 11+.

```powershell
cd C:\Users\anand\source\apex-business-os
npm install
npm run dev -- --host 127.0.0.1
```

Open the URL printed by Vite, normally:

```text
http://127.0.0.1:5173/
```

Useful commands:

```powershell
npm run build
npm test
npm run lint
```

## Environment variables

Copy `.env.example` to `.env.local` for local browser configuration:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
# Legacy fallback only when the project does not expose a publishable key.
VITE_SUPABASE_ANON_KEY=
```

Never put service-role keys, Meta API keys, or other backend secrets in `VITE_*` variables. Configure these only as Supabase Edge Function secrets:

```text
META_API_URL=https://api.meta.ai/v1/responses
META_MODEL=muse-spark-1.3
META_API_KEY=your-meta-api-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
APP_ORIGIN=http://127.0.0.1:5173
```

The Meta gateway uses the Responses API with structured JSON output. The key and service-role key are server-only Edge Function secrets and must never be placed in `.env.local` or any `VITE_*` variable. The application ledger uses the verified Muse Spark pricing table and blocks requests over the $90 hard limit when pricing and token reservation are available. The remaining $10 of the $100 allocation is intentionally preserved.

## Meta model routing

Meta documents an authenticated `GET https://api.meta.ai/v1/models` catalog endpoint. Apex treats the catalog as an availability signal and uses a backend registry for capabilities; the catalog schema does not guarantee capability metadata. The registry currently contains only model IDs documented by Meta. The inquiry workflow routes `structured_extraction` automatically among verified, priced standard Muse Spark models and records the requested capability, selected model, actual returned model, latency, provider usage, and fallback metadata.

The migration `supabase/migrations/20261104003000_apex_model_routing.sql` adds owner-controlled automatic/manual routing settings and is applied to the development project. The `model-catalog` Edge Function exposes the catalog, validates owner changes, and offers a safe `test_connection` probe (any member can run it; it never returns secrets). Image generation, speech transcription, and segmentation are documented in the registry for display but are not enabled in the existing business workflow.

## Migrations and functions (applied)

All six migrations through `20261104005000_apex_agent_os.sql` are applied to the development project, including business completion (`suppliers`, `organization_settings`, discounts) and the Agent OS tables (`agent_runs`, `agent_instructions`, `provider_registrations`, `integration_registrations`; RLS enabled, member-read/admin-write, secret references only — never key values). All four Edge Functions are deployed; `model-catalog` is v5 with the dashboard decoupling, org-fallback, guarded loaders, and multi-origin CORS fixes.

Redeploy a function after reviewing its source:

```powershell
npx supabase functions deploy model-catalog --use-api --yes
```

## Multi-agent operating system

Ask Apex (floating launcher on every authenticated page) runs ten typed agent profiles (Orchestrator, Worker, Sales, Finance, Operations, Quality Checker, Admin, Writer, Marketing, Reporter) over 19 organization-scoped tools. Reads and low-risk writes execute under the user's RLS role; quotation writes are high-impact and require an approval card. The demonstration request ("Review pending inquiries… show me the proposals for approval") runs Sales → Operations → Finance → Quality Checker → Reporter against real records and persists only approved draft quotations. Agent runs, instructions, and provider/integration registrations persist in Supabase. Meta is configured server-side; configured, reachable, and tested are distinct states, and only Settings → Test connection proves a live Meta request. OpenAI-compatible registration uses server secret names only; no provider key is ever entered in the browser.

## Hackathon demo

1. Sign up with a real email/password and create `Apex Demo Organization`.
2. After the Edge Functions are deployed, open Settings and click `Load Demo Workspace`.
3. Open AI assistant and submit the sample customer inquiry.
4. Show the structured Meta analysis, database product context, and deterministic quotation preview.
5. Review the missing-information and warning panels.
6. Approve once as a manager, admin, or owner.
7. Replay the same approval to demonstrate idempotent recovery.
8. Open AI Activity to show request, model, token, and cost status.

The dedicated development project `apex-business-os-dev` has the three reviewed migrations applied and is up to date. The local function sources include `inquiry-workflow`, `approve-inquiry-workflow`, and `seed-demo-workspace`; they must be explicitly deployed before the live workflow or demo seeding action can run.

Deploy only after reviewing the function source:

```powershell
npx supabase functions deploy inquiry-workflow --remote=gnxuyonahsfgeehgpomg --use-api
npx supabase functions deploy approve-inquiry-workflow --remote=gnxuyonahsfgeehgpomg --use-api
npx supabase functions deploy seed-demo-workspace --remote=gnxuyonahsfgeehgpomg --use-api
```

The Meta secrets `META_API_KEY`, `META_API_URL`, and `META_MODEL` are configured in the dedicated project. Supabase-provided server secrets remain server-side. Do not paste secret values into this repository or chat.

The app does not use mock authentication. Without Supabase variables it shows a configuration screen; with a connected project it uses Supabase Auth, session restoration, membership loading, and sign-out.

## Meta API development toolkit

PowerShell helpers for Meta connectivity, model listing, safe inquiry/document analysis, and JSON validation are documented in [`scripts/meta/README.md`](scripts/meta/README.md). They use `META_API_KEY`, `META_API_URL`, and `META_MODEL` from the current shell session and write results to `outputs/meta/`.

## Preview status

All modules are operational against organization-scoped Supabase data: dashboard with shortcuts and onboarding checklist, customers, products & services, suppliers (needs pending migration), inquiries, quotations with lines and print/export, sales & opportunities, tasks & follow-ups, AI assistant with approve/reject, AI activity, reports, and full settings (workspace, company profile, financial defaults, demo load/reset, Meta configuration with connection test).

The local preview is available at `http://127.0.0.1:5173/` via `npm run dev -- --host 127.0.0.1`. The development project has all four reviewed migrations applied and all four Edge Functions deployed. Applying the pending business-completion migration, redeploying the updated functions, and running a real signup plus Meta connection test still require the user-controlled steps described above.
