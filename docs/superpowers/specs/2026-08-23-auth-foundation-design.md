# Auth Foundation — Design

## Overview

Phase 1 of two. Adds user accounts — sign up, log in, log out, email
verification, password reset — as a standalone subsystem, following the
existing `src/lib/*.ts` (pure functions, `prisma` first param) →
`src/actions/*.ts` (`'use server'`) split already used throughout this
codebase.

**This phase does not change who owns a `Collection`, `Deck`, `Batch`, or
`Setting`.** Those tables gain no new columns here, and every existing
page keeps reading/writing the same global data it does today. Once this
ships, multiple people can create accounts and log in/out, but they will
all still see the same shared collection until Phase 2 (a separate
spec/plan) attaches ownership to that data and closes the access-control
gaps `CLAUDE.md` already flags (`importCsvToCollection`, `approveImportBatch`,
`removeFromImportBatch`, `removeFromBatch`, `approveBatch`,
`quickAddSet`/`clearSet`/`undoQuickSetChange`, and the CSV export route's
`?collectionId=` param — all currently accept a client-supplied id with no
ownership check). Phase 2 is also where the existing real collection data
gets assigned to the project owner's new account, and where the
`Collection.isDefault` concept becomes per-user rather than singular.

This project has moved from "single-user, no login" (`CLAUDE.md`'s
original phase 1 scope) to **open self-registration**: anyone who reaches
the deployed site can create an account. That's a materially higher
security bar than an invite-only tool — email enumeration protection,
rate limiting, and a real password-reset path are all in scope here, not
deferred niceties.

## Scope

In scope:
- `User`, `Session`, `VerificationToken` Prisma models (new tables only —
  no changes to any existing table).
- Sign up, log in, log out.
- Email verification (non-blocking — an unverified user can use the app
  immediately; email support in general is gated on Phase 1B below).
- Forgot-password / reset-password.
- Session-cookie-based auth, checked via `middleware.ts` for page access
  and independently inside every auth-requiring Server Action (defense in
  depth — a redirect at the page level doesn't protect the action itself
  from being invoked directly).
- In-memory rate limiting on login/signup/forgot-password.
- `src/lib/email.ts`'s `sendEmail()`, backed by Resend's HTTP API, with a
  test-mode fallback (see "Email sending") so the full verify/reset flow
  is usable and testable before a sending domain exists.

Out of scope for this phase (deferred to Phase 2 — data scoping):
- Any `userId` column on `Collection`, `Deck`, `Batch`, or `Setting`.
- Assigning the existing real collection data to an account.
- Closing the access-control gaps on the functions listed in `CLAUDE.md`
  that accept a client-supplied `collectionId`/`batchId`.
- Per-user "default collection."
- Any UI change to `/`, `/builder`, `/collections`, `/decks`, `/sets/*`,
  `/settings`, `/discover` beyond what's needed to show a logout control
  and (once Phase 2 lands) an unverified-email reminder banner.

Out of scope indefinitely (unchanged from `CLAUDE.md`):
- Full interactive deckbuilding.
- OAuth/social login — email+password only.

## Data model

```prisma
model User {
  id                 Int                  @id @default(autoincrement())
  /// Always stored lowercased/trimmed — lookups normalize the same way,
  /// so "Foo@x.com" and "foo@x.com" can't register as separate accounts.
  email              String               @unique
  /// "<saltHex>:<derivedKeyHex>" — see "Password hashing".
  passwordHash       String
  emailVerifiedAt    DateTime?
  createdAt          DateTime             @default(now())
  updatedAt          DateTime             @updatedAt
  sessions           Session[]
  verificationTokens VerificationToken[]
}

model Session {
  /// The random token itself is the primary key and the cookie value —
  /// no separate id/token split, one less thing to keep in sync.
  id        String   @id
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}

model VerificationToken {
  /// The random token itself, same pattern as Session.id.
  id        String   @id
  userId    Int
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// 'email_verify' | 'password_reset'
  purpose   String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId, purpose])
}
```

One `VerificationToken` table covers both flows rather than two parallel
tables — they're the same shape (an expiring, single-use token tied to a
user), and this schema already prefers a string discriminator over
duplicated tables for that kind of variation (e.g. `Batch.status`,
`CardFormatLegality.status`).

This is a purely additive migration — three new tables, no changes to any
existing table or column. No hand-sequencing needed (contrast with the
multi-collection Phase 1 migration, which had to hand-guide a primary-key
change); a plain `prisma migrate dev` generates this correctly.

## Password hashing

Node's built-in `crypto.scrypt` — no new dependency, OWASP-recommended
KDF.

```ts
// src/lib/auth.ts
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = scryptSync(password, salt, 64)
  return `${salt}:${derivedKey.toString('hex')}`
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':')
  const derivedKey = scryptSync(password, salt, 64)
  return timingSafeEqual(derivedKey, Buffer.from(hashHex, 'hex'))
}
```

`timingSafeEqual` requires equal-length buffers — both sides are always a
64-byte `scrypt` output here, so this holds by construction. Passwords
must be non-empty and at least 8 characters (checked in the action layer,
matching this codebase's existing validation style — e.g. `startBatch`
rejecting a non-positive `expectedCount` — a thrown `Error` with a message
the form displays directly).

## Sessions

- Token: `randomBytes(32).toString('base64url')` — 256 bits, URL/cookie-safe
  with no escaping needed.
- Cookie: name `session`, `httpOnly: true`, `secure: process.env.NODE_ENV
  === 'production'`, `sameSite: 'lax'`, `path: '/'`.
- Expiration: 30 days, sliding. `getSessionUser()` checks `expiresAt`; if
  more than half the window has elapsed (i.e. less than 15 days remain),
  it extends `expiresAt` to `now + 30d` in the same lookup and reissues
  the cookie with a matching `Max-Age`. This keeps an active user
  perpetually logged in without a DB write on every single request.
- `logOut()` deletes the `Session` row and clears the cookie.
- `resetPassword` calls `deleteAllSessionsForUser` — a successful reset
  invalidates every existing session for that account, including
  whatever session (if any) reset it.

**Security note on TLS:** open self-registration means real strangers'
passwords cross the network on every login. `README.md`'s production
deployment doc currently lists TLS via Certbot as "optional but
recommended" — once this ships, that should be treated as required, not
optional, for any deployment reachable outside localhost. This design
doesn't change the README's wording itself (that's a docs/deploy
follow-up, not part of this spec), but it's called out here so it isn't
missed.

## `src/lib/auth.ts` — interface

```ts
export function hashPassword(password: string): string
export function verifyPasswordHash(password: string, stored: string): boolean

export async function createUser(prisma: PrismaClient, email: string, passwordHash: string): Promise<number>
export async function findUserByEmail(prisma: PrismaClient, email: string): Promise<UserSummary | null>

export async function createSession(prisma: PrismaClient, userId: number): Promise<{ token: string; expiresAt: Date }>
/** Looks up the session, checks expiry, applies the sliding-window extension described above. Returns null for a missing/expired token — callers treat that identically to "not logged in." */
export async function getSessionUser(prisma: PrismaClient, token: string): Promise<{ user: UserSummary; refreshedExpiresAt: Date | null } | null>
export async function deleteSession(prisma: PrismaClient, token: string): Promise<void>
export async function deleteAllSessionsForUser(prisma: PrismaClient, userId: number): Promise<void>

export async function createVerificationToken(
  prisma: PrismaClient,
  userId: number,
  purpose: 'email_verify' | 'password_reset'
): Promise<string>
/** Single-use: deletes the token row on successful consumption. Returns null for missing, expired, or purpose-mismatched tokens — callers can't distinguish which, by design (no information leak about *why* a link is dead). */
export async function consumeVerificationToken(
  prisma: PrismaClient,
  token: string,
  purpose: 'email_verify' | 'password_reset'
): Promise<{ userId: number } | null>
```

`UserSummary` excludes `passwordHash` (`{ id, email, emailVerifiedAt,
createdAt }`) — nothing outside `auth.ts` itself ever needs the hash.

Verification tokens expire after 1 hour (`password_reset`) / 24 hours
(`email_verify`) — reset links are higher-value to an attacker who
intercepts one, so they get a shorter window.

## `src/actions/authActions.ts` — interface

```ts
'use server'

export async function signUp(email: string, password: string): Promise<{ error?: string }>
export async function logIn(email: string, password: string): Promise<{ error?: string }>
export async function logOut(): Promise<void>
export async function verifyEmail(token: string): Promise<{ error?: string }>
/** Always resolves successfully from the caller's perspective — see "Email enumeration" below. */
export async function requestPasswordReset(email: string): Promise<void>
export async function resetPassword(token: string, newPassword: string): Promise<{ error?: string }>
```

`signUp` and `logIn` both set the session cookie via `next/headers`'
`cookies()` on success and redirect (`redirect('/')` from
`next/navigation`) rather than returning a success value — matching how a
form submission that changes where you are should behave. They return
`{ error }` only on the failure path, where the calling form stays put
and displays the message.

### Flows

- **Sign up**: normalize email (lowercase/trim) → reject if password is
  under 8 characters → if the email is already registered, skip creating
  a duplicate `User` but respond exactly like the success path (see
  "Email enumeration") and send a "you already have an account" email to
  that address instead of a verification email → otherwise create the
  `User`, create a session immediately (no block-until-verified — the
  user is logged in right away), create an `email_verify` token, send the
  verification email.
- **Log in**: normalize email → look up the user → `verifyPasswordHash` →
  on any failure (unknown email or wrong password), return the *same*
  generic `"Invalid email or password"` message — never "no account with
  that email," which would confirm/deny registration.
- **Log out**: delete the session, clear the cookie, redirect to
  `/login`.
- **Verify email**: consume the `email_verify` token → set
  `emailVerifiedAt` → redirect to `/` with a confirmation. An
  expired/invalid token shows "This link has expired or is invalid" with
  a way to request a new one (requires being logged in, since there's no
  standing "resend verification" page without a session to attach it to).
- **Forgot password**: normalize email → if a user exists, create a
  `password_reset` token and email it; if not, do nothing — either way,
  the action returns the same "if that email exists, we've sent a reset
  link" response with no branching visible to the caller.
- **Reset password**: consume the `password_reset` token → reject a new
  password under 8 characters → `hashPassword` → update the user →
  `deleteAllSessionsForUser` → redirect to `/login` with a "password
  updated, log in again" message.

### Email enumeration

Signup and forgot-password never reveal via their response whether an
email is already registered. The only differentiator is which email gets
sent (a verification email vs. an "you already have an account, log in
or reset your password" email) — invisible to whoever submitted the
form. Login's error message is likewise identical for "no such account"
and "wrong password."

## Pages

Plain Server Component pages + a form calling the matching Server Action,
matching this app's existing page/action pairing (no client-side form
library):

- `/signup` — email + password fields.
- `/login` — email + password fields, plus a "Forgot password?" link.
  Accepts an optional `?next=` query param (set by the middleware
  redirect below) and redirects there on success instead of always going
  to `/`.
- `/verify-email?token=...` — no form, just consumes the token on load
  and shows the result.
- `/forgot-password` — email field only.
- `/reset-password?token=...` — new-password field.

Styling follows whatever existing form component (e.g. the simple-mode
builder form) already establishes for this app's Tailwind conventions —
no new visual language introduced here.

## Route protection

`middleware.ts` requires a valid session for every route except:
`/login`, `/signup`, `/verify-email`, `/forgot-password`,
`/reset-password`, and Next's own static/internal paths. An
unauthenticated request to a protected route redirects to
`/login?next=<original path>`. The exact middleware/cookie-reading API is
confirmed against `node_modules/next/dist/docs/` at implementation time
per this repo's Next-16 warning — the redirect behavior above is the
contract; the API surface it's built on isn't assumed from memory.

This is a coarse, whole-app gate for this phase, consistent with "no
ownership model yet" — it answers "is someone logged in," not "does this
particular collection belong to them" (that's Phase 2's job, once there's
an owner to check against).

Middleware (`NextRequest`/`NextResponse` cookies) and Server Actions
(`next/headers`'s `cookies()`) read/write cookies through different APIs,
so "checked via middleware for page access and independently inside every
auth-requiring Server Action" is two call sites, not one shared function
body. Both wrap the same sequence — read the `session` cookie, call
`getSessionUser`, reissue the cookie if it came back with a
`refreshedExpiresAt` — but the exact shape of that shared logic (a
context-agnostic helper both sites call into, vs. two thin
context-specific wrappers) is an implementation-time decision, made
after reading `node_modules/next/dist/docs/` for what Next 16 actually
offers here.

## Email sending

```ts
// src/lib/email.ts
export async function sendEmail(to: string, subject: string, html: string): Promise<void>
```

If `process.env.RESEND_API_KEY` is unset, `sendEmail` logs `to`,
`subject`, and `html` (which includes the raw verification/reset link) to
the console instead of making a network call, and resolves successfully.
This is the default in dev today, since no sending domain exists yet —
every auth flow is fully exercisable by copying the link out of the
terminal.

If `RESEND_API_KEY` **is** set, `sendEmail` also requires
`process.env.EMAIL_FROM` (e.g. `no-reply@yourdomain.com`) and calls
Resend's plain HTTP API directly:

```ts
await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
})
```

No SDK dependency — Resend's API is a single JSON POST, and `fetch` is
already available. Flipping from test-mode logging to real delivery is
setting two env vars, not a code change.

## Rate limiting

`src/lib/rateLimit.ts`, in-memory (a module-level `Map`), acceptable
because this app is explicitly a single Node process (no horizontal
scaling to make an in-memory limiter inconsistent across instances):

```ts
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean
```

Returns `true` if the call is allowed (and records it), `false` if the
key has hit `limit` calls within the trailing `windowMs`. Applied in
`authActions.ts` at the top of `logIn`, `signUp`, and
`requestPasswordReset`, checked against **two independent keys** per
call — `` `${action}:ip:${ip}` `` and `` `${action}:email:${email}` `` —
so a single IP hammering many accounts and a distributed attacker
hammering one account are both caught; either key tripping blocks the
call. The client IP is read from the `X-Forwarded-For` header via
`headers()` (nginx already sets this per `deploy/nginx.conf`). Suggested
limits: 10 attempts per 15 minutes for `logIn`, 5 per hour for `signUp`
and `requestPasswordReset` (same limit/window for both the IP and email
keys). Exceeding the limit returns the same generic error a normal
failure would (not a distinct "rate limited" message, which would itself
leak information to an attacker probing the limit).

Resetting on process restart is an accepted tradeoff for this phase, not
a gap to close later — this app already assumes a single long-running
process (`CLAUDE.md`'s "single local process" tech-stack rationale).

## Testing

- `src/lib/auth.test.ts` — `hashPassword`/`verifyPasswordHash` round-trip
  and mismatch; `createSession`/`getSessionUser` for a valid, expired, and
  nonexistent token, and the sliding-window extension actually extending
  `expiresAt` when within the trailing 15 days; `deleteSession`;
  `deleteAllSessionsForUser` removes every session for a user and none for
  another; `createVerificationToken`/`consumeVerificationToken` for valid,
  wrong-purpose, expired, and already-consumed (second consume returns
  `null`) tokens.
- `src/lib/email.test.ts` — no `RESEND_API_KEY`: asserts `console.log` was
  called with the link and that `fetch` was never called (spy/mock both).
  With `RESEND_API_KEY` set: asserts `fetch` was called once with the
  correct URL, headers, and body.
- `src/lib/rateLimit.test.ts` — allows calls under the limit, blocks the
  call that crosses it, allows again once the window has elapsed.
- `src/actions/authActions.test.ts` — the enumeration-safety behaviors
  specifically: `signUp` against an existing email and a new email return
  identically-shaped responses; `requestPasswordReset` likewise for an
  existing vs. unknown email; `logIn` returns the same error string for
  unknown-email and wrong-password cases.
- Basic render/interaction tests for the five new pages/forms, matching
  this repo's existing form-component test pattern (e.g.
  `BatchBuilderForm.test.tsx`): renders fields, submits, shows the
  returned error inline.

## Open items carried into Phase 2

Recorded here so they aren't lost, not because they're being decided now:

- Assigning existing `Collection`/`Deck`/`Batch` rows to the project
  owner's account.
- `userId` on `Collection`, `Deck`, `Batch`, `Setting`, and every
  data-layer function that currently takes a bare `collectionId`/`batchId`
  gaining an ownership check against the logged-in user.
- What "default collection" means once it's per-user instead of a single
  global row.
- Whether `Setting` (today a single global key/value table) becomes
  per-user or stays instance-wide (e.g. `Builder Mode` arguably makes
  sense per-user; some future settings might not).
