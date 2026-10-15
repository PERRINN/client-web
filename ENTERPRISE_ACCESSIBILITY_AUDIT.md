# PERRINN enterprise accessibility audit

Audit date: **15 October 2026**, public internet from this workstation. This concerns corporate network accessibility and security configuration; it is not a WCAG accessibility assessment or penetration test.

**Overall: FAIL for repository security readiness; WARNING for corporate network readiness.** Public web transport works. No public transport outage or certificate defect was observed. The repository contains a broad Firestore read grant requiring urgent review. Authentication, token renewal and Firestore preflight results are encouraging, but an actual corporate browser session remains unverified.

Evidence: [dated public results](audits/enterprise/2026-10-15.json): **43 PASS, 12 WARNING, 1 FAIL, 8 INFO**, with 36 public HTTP requests in the final run. Statuses mean PASS = the specific check passed; WARNING = risk or incomplete verification; FAIL = observed failure or unsafe repository configuration; INFO = context. Repository findings do not establish the state of deployed rules, IAM or Functions implementations.

## Scope and architecture

Inspected `AGENTS.md`, root and Functions package scripts, Angular build/routes/modules/services/templates, production environment mapping, `.firebaserc`, Firebase Hosting configuration, security rules and relevant payment/storage handlers. Angular uses NgModules, AngularFire compatibility APIs and Firebase SDK 12. Hosting serves `dist/`, rewrites routes to the app shell and enables Angular's service worker in production. Auth is email/password; core collaboration uses Firestore. Storage supplies images. Realtime Database is configured/imported but no active client calls were found. Payments use two HTTPS Functions and redirect to a provider-supplied checkout URL. Drive/GitHub integration API traffic happens in Functions, not in the engineer's browser.

No application, rules, data shape, Functions, Firebase configuration, DNS, certificate or production setting was changed. No credentials, login attempts, database/document reads, storage listings, payment orders or production writes were used. No branches, commits or deployment were made. Existing README and Unity prototype edits were preserved.

## Current findings

| Status | Area | Evidence / implication |
| --- | --- | --- |
| PASS | HTTPS and redirects | `http://perrinn.com/` → 301 → `https://perrinn.com/` → 200. HTTPS www → 301 → apex → 200. HTTP www takes two 301 hops, with HTTPS preserved after the first hop. No loops or unexpected domains. |
| PASS | TLS | Native trust-chain and hostname validation succeeds. Apex expires **19 December 2026 08:29:12 UTC**; www expires **25 December 2026 00:21:56 UTC**. Both negotiated TLS 1.3. This does not enumerate all supported protocol versions/ciphers or prove revocation/CT status. |
| PASS | HSTS | Live app sends `Strict-Transport-Security: max-age=31556926`. No `includeSubDomains`/preload observed; extending coverage needs a subdomain review. |
| WARNING | Security headers | Live root response has no enforced CSP, `X-Content-Type-Options`, Referrer-Policy or Permissions-Policy. Hosting source sets cache headers only. No framing policy was observed. Missing headers increase exposure and may affect enterprise assessment; they do not prove a particular workplace filter blocks the site. |
| PASS | DNS / availability | Apex A records: `151.101.1.195`, `151.101.65.195`; www CNAME points to apex. All identified core hosts resolve. App shell, `/home`, `/login`, initial JS/CSS, manifest and service-worker files respond 200 with expected content types. Route checks verify the shell, not rendered data. |
| INFO | DNS hardening | NS: `ns01.domaincontrol.com`, `ns02.domaincontrol.com`. No apex CAA record returned. Missing CAA/AAAA is not an availability failure; CAA could constrain certificate issuance after issuer/renewal review. DNSSEC validation, authoritative consistency, IPv6 reachability and global propagation were not tested. |
| PASS | Limited mixed-content check | No HTTP load-bearing resource URLs in initial HTML; initial stylesheet has no HTTP `url()` references. No external executable script tag is needed in the initial shell. This is not runtime mixed-content coverage. |
| WARNING | External fonts | Production HTML inlines Google Fonts CSS, then fetches six `fonts.gstatic.com` font files; all six return 200 and `Access-Control-Allow-Origin: *`. Blocking these can remove meaningful icons. Source/build still depends on `fonts.googleapis.com`. No third-party analytics/ad initialization was found. |
| PASS | Auth / Firestore CORS baseline | OPTIONS to password sign-in, secure token and Firestore Listen paths permits the requested method/headers from apex and www. Native HTTPS validation succeeds during these requests. No API key/account/rules behavior was tested; this is not proof of successful login, refresh or real-time chat. |
| WARNING | Storage preflight | OPTIONS to the bucket collection path advertises `Access-Control-Allow-Methods: GET`, despite requesting POST. Both origins get ACAO `*` and relevant headers, but POST is not advertised. This simplified probe lacks a real SDK upload URL/session: confirm actual upload requests before diagnosing a production defect or changing bucket CORS. Signed-image availability was not tested to avoid retrieving user content. |
| WARNING | Auth mapping | `src/app/app.module.ts` sets `authDodash` instead of `authDomain`. It fails to map the configured auth helper domain. Password login does not itself require popup/redirect helpers, so this is not evidence that current password login fails. Password-reset action domains/live policy need verification. |
| FAIL | Repository Firestore privacy | Recursive `match /{document=**} { allow read; }` grants unauthenticated reads across all document paths. Narrower owner conditions cannot revoke this overlapping grant, including for `lastSeen` and payment subcollections. This conflicts with assumptions of private paths. **Deployed rules were not inspected and no private production reads were attempted.** |
| WARNING | Repository Storage boundary | `storage.rules` allows public reads and any authenticated user to write any object, without path ownership, size or content-type restrictions. Review intended public-media policy and overwrite/abuse exposure; the deployed rules were not tested. |
| WARNING | Repository payment boundary | Both payment handlers use permissive CORS and contain no Firebase ID-token verification/ownership checks. `syncRevolutOrderStatus` accepts a client-supplied user and writes via Admin SDK. Order creation logs personal/payment payloads and a key suffix. Public OPTIONS succeeds, but does not establish POST access/IAM or the deployed implementation. Review this boundary before enterprise approval. |
| WARNING | Caching and update behavior | Root, `/home`, `/login` and `/ngsw.json` return `max-age=3600`. Stable `/ngsw-worker.js` returns `public,max-age=31536000,immutable`. Source cache rule covers all JS/CSS rather than only hashed assets. Investigate stale releases through corporate caches and service-worker update semantics; `/index.html`'s source no-cache rule does not establish equivalent root/rewrite behavior. |
| WARNING | Reputation signals | Open Graph image uses `tinyurl.com`; shortened URLs add an avoidable preview dependency and can trigger filtering. Shared cloud APIs/storage, arbitrary message links and the payment flow may face category filtering. This audit found no evidence proving malware or blocklisting; no authenticated vendor reputation scores or browser safe-browsing verdicts were obtained. |
| INFO | Local Unity exception | One prototype explicitly connects to `ws://127.0.0.1:42480/live`. Browser security policy can block this on hosted HTTPS. It is not needed for the core application and should not become a general firewall exception. |

The complete identified fixed-host inventory, feature-specific exceptions and unresolved dynamic dependencies are in [ENTERPRISE_NETWORK_ALLOWLIST.md](ENTERPRISE_NETWORK_ALLOWLIST.md). Allowing only `perrinn.com` is insufficient for authentication and core collaboration; the API/storage/font destinations matter independently.

## Recommended fixes, in priority order

Follow-up investigation: [the proposed least-privilege policy](data-model.md#proposed-least-privilege-read-policy--2026-10-15) traces public/private readers and writers, identifies authentication emails embedded in public message records, and proposes staged containment followed by sanitized public feeds. It is a proposal only; no rules, schema, Functions or production changes have been applied.

1. **P0 — Confirm the intended Firestore privacy boundary and deployed rules.** Review readers/writers and private/payment paths, agree a least-privilege migration, then obtain approval before changing rules. Include Storage path ownership and upload constraints in that review. Test unauthenticated, owner and cross-user access with emulators. Do not blindly remove the public grant: some existing public feeds intentionally rely on it.
2. **P0 — Review payment authorization and logging.** Inspect deployed IAM/code, require trusted identity and ownership for user-scoped operations, validate provider/order linkage and amounts, and remove sensitive payload/key-fragment logging. Backend implementation changes require the specific explanation and approval mandated by AGENTS.md. CORS origin restrictions alone are not authorization.
3. **P1 — Validate actual corporate end-to-end use.** Apply the core hostname allowlist and follow its acceptance procedure, including token refresh, Firestore listeners/reconnects and Storage uploads. Investigate the Storage POST preflight warning using the actual SDK request. Check proxy buffering/category logs before requesting any exception. No unusual ports are needed for core app use.
4. **P1 — Add security headers through a reviewed hosting change.** Start with `nosniff`, a suitable referrer policy and a least-privilege Permissions-Policy. Develop CSP in report-only mode before enforcement, covering Angular's optimized inline font styles, app styles, Google Fonts, Firebase APIs and legitimate media. Include a framing policy. Do not copy a generic CSP that silently breaks auth, uploads or payments.
5. **P1 — Correct and verify `authDomain`.** Confirm the intended helper domain, authorized domains, password-reset links and any future OAuth behavior. Test existing email/password behavior before rollout. Keep the current architecture.
6. **P2 — Remove avoidable network dependencies.** Replace the shortened preview URL with a stable first-party HTTPS asset; consider bundling the icon fonts with their licenses. Validate needed external links/provider checkout hosts separately instead of allowing broad Google/Revolut wildcards.
7. **P2 — Review cache policies and optional DNS hardening.** Ensure HTML, service-worker manifests and stable worker filenames revalidate appropriately while hashed assets retain long caching. Review CAA and subdomain HSTS only after confirming renewal/subdomain requirements. Missing IPv6 is not an urgent defect.

These are recommendations only. No infrastructure fixes have been applied.

## Reusable checks and CI

The dependency-free Node tool uses built-in DNS, TLS, HTTP and filesystem APIs. It accepts only its fixed public hostname set, validates certificates, rejects redirect downgrades/unexpected redirect hosts, caps responses at 6 MiB, bounds network operations at 12 seconds and limits initial assets/font probes. Only GET/HEAD/OPTIONS requests are made. No Firebase SDK/CLI, account, production build or `npm install` is needed to run it. Evidence retains hostname/path/status and selected headers, never response bodies, keys, cookies or signed query strings. It does not follow arbitrary application/metadata links.

Run with Node 22 or 24 from the repository root:

```sh
npm run audit:enterprise:test
npm run audit:enterprise -- --output /tmp/perrinn-enterprise-audit.json
npm run audit:enterprise -- --offline --output /tmp/perrinn-enterprise-offline.json
npm run audit:enterprise -- --strict --output /tmp/perrinn-enterprise-strict.json
```

Default exit code is 1 if any FAIL exists, 0 otherwise; `--strict` also fails on WARNING. The current repository Firestore finding deliberately makes even the offline audit exit 1. A completed audit with findings is different from a tool crash; inspect the JSON and status lines. `--offline` performs source checks without network probes. Source inventory flags unclassified literal hostnames for human review; SDK, runtime and database-derived URLs need separate validation.

The added GitHub Actions workflow runs Mondays at **07:23 UTC**, manually, and when its tooling changes on pushes/PRs. It uses read-only repository permissions, does not retain checkout credentials, needs no secrets and uploads JSON evidence for 30 days even on failure. It does not install application dependencies, deploy, open issues or send messages. The known FAIL will make runs red until resolved. Scheduling only takes effect after the workflow reaches the default branch and Actions/schedules are enabled; **the workflow has not been run on GitHub during this task**. GitHub network results cannot certify an employer's proxy. Corporate environments using PAC files or custom trust stores may need an approved runtime/network configuration; never disable certificate validation to get a PASS.

Validation completed locally: five audit self-tests pass, including offline/no-probe output and CLI rejection; production build passes (existing unused `environment.dev.ts` warning); client lint passes with 146 existing warnings and zero errors. No client/backend code was changed. Functions defines no relevant test/lint script, so no Functions execution was performed.

## What remains unverified

Corporate proxy/firewall/category behavior, browser TLS inspection trust, vendor reputation, email deliverability, actual sign-in/token renewal, authorized domains/API-key restrictions, real-time Firestore traffic/writes, deployed rules/IAM, image uploads/downloads, payment checkout/3-D Secure and all database-supplied external URLs require authorized operational/browser review. The checks neither read private data nor prove least privilege. Runtime mixed content, lazy resources, redirects from user content, revocation/OCSP, DNSSEC and geographic/IPv6 failures remain outside the automated evidence. No WCAG/UI changes were included.

## Primary references

- [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth) — account and token endpoints.
- [Firebase Auth redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices) — helper domains; relevant if redirect auth is introduced.
- [Firestore settings](https://firebase.google.com/docs/reference/js/firestore.firestoresettings) — proxy/long-polling behavior; installed SDK defaults were also inspected.
- [Firestore rule structure](https://firebase.google.com/docs/firestore/security/rules-structure) — overlapping matches grant access if any condition permits it.
- [Firebase Hosting cache behavior](https://firebase.google.com/docs/hosting/manage-cache) — default caching and header configuration.
