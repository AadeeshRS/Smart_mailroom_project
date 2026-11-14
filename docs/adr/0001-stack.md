# ADR 0001: The stack that was built, against the Phase 0 design

| | |
|---|---|
| Status | Accepted, 2026-11-15 (plan task 8.6, finding F33) |
| Supersedes | §1 and §2 of the Phase 0 `ARCHITECTURE.md` (design baseline commit `29ef28c`, kept outside this repo with `MASTER_PLAN.md`, `BLUEPRINT.md`, `API_CONTRACT.md`, `DATA_MODEL.md` and `REQUIREMENTS_TRACEABILITY.md`) |
| Source of truth now | [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) |

## Context

The Phase 0 design planned a modular monolith: one **Next.js PWA** for students, the counter and admins, one
**FastAPI** process (Python 3.12, SQLAlchemy, Alembic) and PostgreSQL. Sign-in was a passwordless email code with
a cookie session, phones were verified by SMS, and parcels matched only on a verified phone.

What the team built first (v1) was different: **Fastify** (Node, TypeScript, Prisma) and an **Expo** (React Native)
app, with a demo login and a different parcel workflow. The v2 plan kept that scaffolding (the contract tooling,
the PostgreSQL test pattern, the browser-test harnesses, the UI kit) and replaced the domain layer. Nothing
recorded why the stack differed from Phase 0, so the two sets of documents disagreed.

## Decision

Keep **Fastify 5 + Prisma 7 + PostgreSQL 17** for the API and **Expo SDK 58** for the app, with a hand-written
OpenAPI contract that both sides are generated from. The Phase 0 stack is not built.

Reasons:

- **Working code over a rewrite.** v1 already had a tested API, a contract-first toolchain and an app; moving to
  FastAPI and Next.js would have thrown that away for no gain in what the mailroom needs.
- **One language.** TypeScript runs the contract tooling, the API and the app, so the generated types are used
  directly on both sides, and `api/` and `mobile/` still never import each other.
- **A native app for the jobs that need a phone.** The camera scanner and push notifications use Expo's modules,
  and the team previews every change in Expo Go without builds (plan §0 rule 8). The Phase 0 PWA needed an HTTPS
  tunnel for the camera and had no push.

## What changed from Phase 0, and why

| Concern | Phase 0 design | Built in v2 | Why |
|---|---|---|---|
| Client | Next.js PWA | Expo app (Expo Go in development); its web build is used only by the browser tests | Above |
| API | FastAPI, SQLAlchemy, Alembic | Fastify, Prisma, Prisma migrations | Above |
| Contract | Generated from FastAPI as `openapi.json` | Written first in `contracts/openapi.yaml`; every operation declares `x-permission`, checked by a route × role matrix test | Contract first keeps the two sides independent |
| Roles | STUDENT, STAFF, SECURITY, ADMIN | MEMBER (student or college staff), OPERATOR, ADMIN | Locked decision L4: college staff receive parcels too, and security and mailroom staff share one OPERATOR role |
| Sign-in | Passwordless email code; httpOnly cookie | College email and password; the email is verified with a 6-digit code, which also resets the password; a bearer token in the phone's secure store | Locked decision L2; a native app has no cookie jar |
| Phone | Verified by SMS before matching | Not verified; typed by the member | No SMS provider (cost, India's DLT rules). Matching on an unverified phone is a convenience, so the operator sees the label name beside the member's name and checks the college ID card when they differ (plan §5.5) |
| Matching | Only on a verified phone, never by name | An open request first (by AWB, else a unique order ID), then the label's phone or email; CONFLICT and AMBIGUOUS flags; manual assign | Locked decision L3: no tracking API returns the recipient and labels sometimes mask the phone, so requests are the dependable match |
| Label reading | Parse the scanned text for name and phone | Scan the AWB only; the operator types the label details; the carrier is detected from the AWB format | No OCR or paid tracking API in v1 (L3) |
| Notifications | In-app feed, email and SMS | In-app list on Home and Expo push; email only for codes; no SMS | Expo push is free; SMS dropped with phone verification |
| Collection | A code and QR per parcel, 10 minutes | One **Collect now** code per member for everything waiting, 15 minutes, which pops up at the counter | One code covers several parcels; the QR credential went with v1's workflow (plan §3.2) |
| Background work | Request background tasks plus a CLI run by the OS scheduler | One worker loop in the API process, every minute | Render's Free plan has no cron jobs, and there's one API instance |
| Hosting | One VM, or a local demo | Render Free (API) and Neon (database) | Locked decision L5 |

## Phase 0 requirements not built

- Disputes (FR-DSP-01 to 03) and the admin's global audit-log search (FR-AUD-04). Each parcel's own history is shown
  in its detail.
- Deny a handover with a reason (FR-COL-08): the operator just doesn't hand over, and the code expires.
- SMS phone verification and the SMS invite for unmatched parcels (FR-USR-01, FR-USR-02, FR-NTF-04), and an admin
  "unlink phone" (FR-ADM-04): phones aren't verified, and a member edits their own.

## Consequences

- The Phase 0 documents describe intent, not the code. When they disagree with this repo, the
  [implementation plan](../IMPLEMENTATION_PLAN.md) and the code win.
- Android pushes need a release build with Firebase credentials (Phase 8); in Expo Go, Android members see their
  parcels and notices on Home.
- Python tooling (uv, ruff, mypy) is not used; the gates are TypeScript, ESLint, Prettier and the test suites in
  `scripts/check.ps1`.
