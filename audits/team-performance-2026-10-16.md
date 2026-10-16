# Team loading investigation — issue #83

Investigated on 2026-10-16 against `perrinn-d5fc1`, starting from client
`e4078b5`. The active batch size remains **200** at the user's request.
A 24-document candidate was measured and then reverted; it did not establish
why the reported long delay occurs.

## Findings

- `TeamService.loadMore()` issues one bounded, one-shot query per page, with no
  per-person Firestore lookups. Search uses loaded records without more reads.
- The existing Q20 / I59 index covers the query's filters and balance order.
  Both tested limits executed successfully. No additional index is indicated.
- These are complete ledger/profile snapshots. The current query returned all
  111 matching contributors; a limit of 200 does not mean 200 reads when fewer
  records match. Data mapping was small compared with query completion time.
- The template tracks rows by document ID. Avatar images already load lazily.
  Currency formatting is synchronous and performs no network requests.
- Shared shell/profile activity and Firebase persistence were inspected. This
  did not identify a confirmed Team-specific bottleneck. Persistence is shared
  across tabs; no global transport or cache settings were changed.
- A standalone SDK attempt encountered an `unavailable` network timeout.
  Browser loading succeeded. Connection variability is a possible contributor,
  not a confirmed explanation for the reported incident.

## Browser timing with the restored limit

Temporary diagnostics around the actual AngularFire query and the following
animation-frame callback observed two local development loads:

| Load | Query resolved | Frame callback, 111 rows present | Interval after query |
| --- | ---: | ---: | ---: |
| First observed load | 1,931 ms | 1,968 ms | 37 ms |
| Explicit reload | 592 ms | 619 ms | 27 ms |

Times start at `loadMore()`, excluding app boot. The callback confirms the rows
were in the DOM by that frame; it does not measure completed image downloads or
precise paint duration. Query waiting dominated these samples, and the reported
long delay was not reproduced. No Firestore error was logged on these browser
loads. Temporary diagnostics were removed; the production service is identical
to the original implementation.

## Earlier batch-size comparison

One sequential pair per transport, without network throttling. SDK runs used
separately initialized apps, installed Firebase 12.19.0 and server-only reads.
No record contents were logged or saved.

| Metric, initial page | Limit 200 (retained) | Limit 24 (reverted) |
| --- | ---: | ---: |
| Returned documents / initial document reads | 111 | 24 |
| SDK query completion | 1,328 ms | 735 ms |
| Mapping SDK docs to `{key, values}` | 5.11 ms | 1.21 ms |
| UTF-8 JSON size of decoded mapped records | 787,662 bytes | 171,077 bytes |
| REST query + response body completion | 660 ms | 298 ms |
| REST JSON response size | 1,900,788 bytes | 410,705 bytes |

The smaller batch reduced work but changed how many contributors are initially
available for search. It was reverted rather than adopted as a root-cause fix.
These are individual observations, not latency percentiles or browser paint
timings. REST sizes include Firestore's typed JSON envelope; neither byte count
measures compressed wire bytes or avatar downloads.

Reproduce the SDK measurement with a separate `initializeApp` instance per limit,
`getFirestore`, and `getDocsFromServer(query(collection(db, 'PERRINNMessages'),
where('userChain.nextMessage', '==', 'none'), where('verified', '==', true),
where('wallet.balance', '>', 0), orderBy('wallet.balance', 'desc'), limit(n)))`.
Measure query completion, then separately map document data and measure its JSON
byte length. Terminate each instance afterward and emit aggregate metrics only.

## Compatibility and validation

No production client changes, data migration, Functions changes, security-rule
changes, index changes or dependency changes remain from this investigation.
The additional regression assertions retain coverage of loading, concurrent-read
prevention, retry cursor preservation and completion with an empty final page at
the original 200-document size. `npm run test:participation` passed all 12 tests
after restoring the limit and removing temporary diagnostics. `git diff --check`
passed. Before publishing, the restored version also passed `npm run build`
(unused `environment.dev.ts` warning) and `npm run lint` (127 existing warnings,
zero errors).

The earlier 24-document candidate passed the production build, lint (127 existing
warnings), 12 regression tests, and desktop/mobile layout checks. Its five pages
returned all 111 unique profile links in the original order. Those checks are
historical evidence for the reverted candidate, not a deployed fix.

Issue #83 remains open: a definitive cause of the reported delay has not been
established. The retained limit is 200; deployment does not resolve the issue.
