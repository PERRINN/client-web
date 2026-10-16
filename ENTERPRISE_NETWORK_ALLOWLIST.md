# PERRINN enterprise network allowlist

Reviewed 15 October 2026. See [the audit](ENTERPRISE_ACCESSIBILITY_AUDIT.md) for evidence, caveats and recommended fixes. The machine-readable inventory is [dependencies.json](scripts/enterprise-audit/dependencies.json).

## Core browser access

Allow outbound HTTPS on TCP 443 using DNS hostnames, including their normal CNAME resolution. Fixed Google/Firebase IP addresses are unsuitable: addresses vary by location and time. Port 80 is useful for the initial HTTP redirect, but users can enter `https://perrinn.com` directly. No inbound firewall opening, VPN, arbitrary port, or local-network access is required for the core app.

| Exact hostname | Purpose and useful URL scope | Required behavior |
| --- | --- | --- |
| `perrinn.com` | Angular app, routes, assets and service worker | GET/HEAD, JavaScript and browser storage |
| `www.perrinn.com` | Alternate entry URL; redirects to apex | HTTPS redirect; no separate app origin in the tested deployment |
| `identitytoolkit.googleapis.com` | `/v1/accounts:*`; email/password login, registration, account management, password-reset requests | HTTPS API POST/OPTIONS |
| `securetoken.googleapis.com` | `/v1/token`; refreshes Firebase ID tokens | HTTPS API POST/OPTIONS; blocking this can break an initially successful session later |
| `firestore.googleapis.com` | `/google.firestore.v1.Firestore/*` WebChannel and Firestore API paths | GET/POST/OPTIONS; sustained real-time responses, reconnects and long polling |
| `firebasestorage.googleapis.com` | `/v0/b/perrinn-d5fc1.appspot.com/*`; profile/chat uploads and media downloads | GET/POST/PUT/DELETE/OPTIONS as used by the SDK; authorization and upload headers |
| `storage.googleapis.com` | `/perrinn-d5fc1.appspot.com/*`; signed image URLs produced by Functions | HTTPS downloads; preserve signed query parameters without logging them |
| `fonts.gstatic.com` | `/s/*`; Material Icons and Symbols font files | Font downloads with CORS; icons are functional UI controls |
| `fonts.googleapis.com` | `/css*`; icon stylesheets in source | Required by the production build optimizer; current live HTML inlines CSS so this host may not be contacted at runtime |

These are the identified core dependencies, not a request to allow `*.google.com`, `*.googleapis.com`, `*.firebaseapp.com`, or all cloud storage. Where supported, scope Storage access to the named bucket. Corporate URL classifiers may label shared Google API/storage services separately from the PERRINN domain.

Firestore's browser SDK uses HTTPS WebChannel; it does not require an arbitrary WebSocket port. A proxy that buffers streaming responses or closes idle connections can break live chat even when the HTML and preflight checks pass. The installed SDK defaults to automatic long-poll detection; verify the actual behavior on the affected network before changing settings. Keep normal TLS validation enabled. Do not introduce a blanket TLS-inspection bypass based on this audit.

## Conditional features and project policy

| Exact hostname | When to allow |
| --- | --- |
| `us-central1-perrinn-d5fc1.cloudfunctions.net` | PRN purchasing: `/createRevolutOrder` and `/syncRevolutOrderStatus`; HTTPS POST/OPTIONS. Core chat does not directly call these endpoints. |
| `perrinn-d5fc1.firebaseapp.com` | Configured Firebase Auth helper domain and potentially password-reset email action links. `authDodash` currently prevents correct SDK mapping; no popup or redirect sign-in is implemented. Check live email action settings. |
| `perrinn-d5fc1.firebaseio.com` | Configured Realtime Database; module is imported but no active app database calls were found. Not established as necessary for current core flows. |
| `apis.google.com` | Firebase popup/redirect helper loader if those login methods are introduced; present in SDK code, dormant for current password login. |
| `www.google.com`, `www.gstatic.com`, `recaptchaenterprise.googleapis.com` | Potential Firebase Authentication bot protection/reCAPTCHA, depending on live project policy. Not observed or confirmed required. Capture a sanitized browser trace if a challenge appears. |

Revolut checkout opens the `checkout_url` returned by the payment service. Its hostname and any bank/3-D Secure redirect chain are **unresolved** in this audit: creating an order would be a production action. Do not treat a guessed Revolut domain or a wildcard as an approved complete payment allowlist. Obtain current provider guidance and a sanitized, authorized test checkout trace before enabling payments in a restrictive environment.

## Optional navigation and dynamic content

| Hostname | Purpose |
| --- | --- |
| `discover.perrinn.com` | Discover navigation |
| `meet.google.com` | Join event meeting |
| `drive.google.com` | Team Drive and activity links |
| `chat.whatsapp.com` | Community |
| `www.youtube.com` | Community videos |
| `www.linkedin.com` | Company page |
| `github.com` | Team projects and activity links |
| `tinyurl.com` | Open Graph preview image shortener in `src/index.html`; metadata for preview crawlers, not a runtime app requirement |

These destinations can have their own assets and redirect dependencies; they are not required to load, sign in, or chat. URLs supplied in Firestore records (images, event locations, Drive links and message links) cannot be exhaustively enumerated from source without reading production content. The allowlist is complete for identified fixed application hosts, not for arbitrary user content or those external products.

`ws://127.0.0.1:42480/live` belongs solely to the opt-in Unity prototype. It is a local editor integration with browser local-network/mixed-content restrictions, not a core PERRINN dependency. Do not ask corporate IT to open this port for normal use.

SDK bundle strings such as `securetoken.google.com` (token issuer), `content-firebaseappcheck.googleapis.com` (dormant App Check), and documentation/license sites are **not evidence of active requests**. No Analytics, Messaging, App Check initialization, external executable script tag or ad tracker was identified in the app initialization/index. Installed SDK packages alone do not establish runtime dependencies. Revalidate this inventory when SDKs, authentication providers, remote content or payment flows change.

## Corporate acceptance procedure

Have an authorized engineer test from the actual workplace network with an approved account. Open a fresh browser profile, load the app, sign in, navigate Home/team/profile/chat, observe new chat data arriving, and confirm the session still works after token renewal. If approved for the test, send a benign message and upload a test image; those actions are deliberately excluded from the public audit. Verify logout, password-reset email delivery/action domains and an approved test checkout separately. Repeat with the service-worker cache cleared and with normal cached navigation.

Inspect browser console and network failures plus IT proxy/DNS/category logs. A 200 HTML response proves little if API calls are blocked. Compare results on and off the corporate network. Record only hostname/path/status and relevant CORS headers; redact tokens, cookies, emails, message bodies, signed URLs and payment information. Run the public audit on each network as a transport baseline; it uses direct Node connections and does not emulate a browser's PAC file, system proxy, certificate store or browser extension policies.
