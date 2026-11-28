# سعي أكاديمي

منصة عربية لشرح مواد الجامعة، تتيح للطلاب طلب اشتراك بعد تسجيل الدخول، وللمشرف إدارة المواد والدروس والطلبات. الدفع والتواصل المالي يتمان خارج الموقع.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, Clerk-managed auth variables, and `SAI_ADMIN_EMAIL` for the single administrator account

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for the API contract
- `lib/db/src/schema/` — course, lesson, and subscription-request tables
- `artifacts/api-server/src/routes/` — authenticated course, student, and admin APIs
- `artifacts/sai-academy/` — Arabic RTL student and administrator website

## Architecture decisions

- Clerk handles sign-in; the API grants administrator access only to the verified primary email configured as `SAI_ADMIN_EMAIL`.
- Lesson links are stored as HTTPS URLs and are returned only to the administrator or a student with an active, approved request.
- Approving a request starts its access period; payment itself is arranged and confirmed outside the website.
- A course can contain at most 30 lesson links.

## Product

- Students browse courses by major, search by course or instructor, request subscriptions, and view their request status.
- The administrator creates and edits courses, then approves requests with an access duration or rejects them.
- The public landing page remains visible without an account; course pages and actions require sign-in.

## User preferences

- Keep the interface light, attractive to students, and in Arabic.
- Do not add online payment processing; students pay by contacting the administrator.

## Gotchas

- Configure `SAI_ADMIN_EMAIL` before using the administrator dashboard.
- Do not treat hiding the admin link in the UI as authorization; admin API routes must keep their server-side check.
- Access to lessons expires automatically when the approved duration ends.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
