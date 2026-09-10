# T030: AI context selection service

## Scope / status

T010 A (PostgreSQL + semantic selection from summaries + selected original evidence) was approved in the working conversation. T030 implements a read-only service and an injectable OpenAI selection adapter. No route, UI, final answer generation, migrations, backfill, deployment or main merge is included. T040 owns authenticated API wiring and answer generation. T090 owns additional historical source storage/import.

## Interface

`createStudentAiContextService({ query, select })` returns `buildContext({ studentId, question, now?, compareAt? })`.

- `query(sql, params)` is an injected PostgreSQL query function.
- `select({ rules, question, phase, limit, items })` returns `{ ids, usage? }`.
- `createStudentAiSelector({ client, model, countTokens?, maxInputTokens? })` supplies the OpenAI implementation. Client/model are explicit. No network or credentials on import.
- Result includes validated evidence, source IDs/versions, Unicode code point ranges, intent, coverage, selected-input character count and selection usage. It is context, not an AI answer.

## Selection

Unknown questions use topic/all-period selection, not latest-only retrieval. Recent questions use latest six dated records, previous-goal questions two. Comparisons require an explicit ISO date, a numeric month interval, or compareAt supplied by caller; ambiguous comparisons return COMPARISON_DATE_REQUIRED. Month subtraction clamps month ends. Comparisons retain latest three and up to two before/after the baseline.

Longitudinal/topic/repeated-issue selection scans bounded summary/quality slices from all stored records. Oversized collections use deterministic, chronologically ordered batches and hierarchical semantic reduction; this is batch-level reduction, not persisted month/quarter summaries. Multiple sources from one period can survive. The latest dated record is retained as a counterevidence candidate. Relevant transcript chunks are selected in a second semantic pass. Overlapping Unicode chunks preserve exact original offsets.

This algorithm does not guarantee zero information loss: per-batch shortlist reduction, limited summaries, and final evidence limits can lose details. Fixed regression cases are not an empirical semantic recall evaluation. Empty/truncated summaries and omitted final excerpts are reported; exceeding hard limits fails explicitly. No full-Drive coverage claim is made from the current minutes table.

## Boundaries

All SQL uses parameterized student_id; both metadata and detail results assert scope. Detail IDs are restricted to the server's candidates; the selector cannot introduce another source. Metadata does not select transcript. Detail fetch checks version stability and missing/duplicate/unexpected rows. Same Drive ID is deduplicated, separate IDs on the same date survive. Unknown dates are reported. No lesson_number prerequisite is imposed.

Persisted transcript content is labelled stored_transcript_unverified: the legacy column alone does not prove it came from a transcription tab. Summary-only evidence is labelled summary. Future source-type enrichment belongs to T090.

Defaults: question 2,000 code points; metadata 2,000 rows (overflow rejected); each summary/quality slice 16,000 characters (reported if truncated); each selected original 2,000,000 characters (overflow rejected); batch serialization 24,000 JS string units; eight candidate records; 12 final excerpts; 24,000 final evidence code points; 48 selection calls. Provider request timeout 60s, retries disabled, response cap 1,200 completion tokens. Selector validates finish/refusal/JSON and allowed IDs. Call limits are request-local, not a monthly cost budget.

The selection adapter accepts the chosen model's token counter; absent a counter it uses UTF-8 byte count as a conservative estimate with a framing reserve. Default token budget 100,000 is an implementation cap, not a statement about every model's supported context length. T040 must supply a model-appropriate token budget/counter and separately bound the final answer request, including metadata, instructions and reserved output.

## Integration / outstanding

T040 must apply requireAuth before calling the context builder, return safe Japanese error mappings, enforce request concurrency/overall deadline and final-answer token budgets, validate generated citations against returned evidence, and avoid raw body/provider error logging. No endpoint is exposed by T030 alone.

Actual provider/DB calls are not exercised here. Real semantic recall, question cost, p50/p95 latency, database plan and full historical coverage remain unverified. Existing data collector measurements are not committed in this change.

## Verification

Unit tests use synthetic records and mocked PostgreSQL/OpenAI boundaries. They cover cross-student canaries, forged IDs, changed/deleted sources, date windows, intermediate historical turning points plus latest counterevidence, duplicate Drive IDs, same-day separate sources, summary-only records, empty/truncated/undated metadata, Unicode evidence offsets, row/source/input limits, hierarchical batches and provider failures.
