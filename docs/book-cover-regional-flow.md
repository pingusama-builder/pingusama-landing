# Regional book-cover discovery

Google Books and Open Library remain the first image providers. Their failure enters
the shared discovery code used by Add book, Save shelf, retries, and legacy ISBN warming.

## Source identity and edition safety

- A maintained registry identifies approved publisher/retailer hosts and product URL paths.
  Search results cannot make themselves trusted by claiming to be a publisher.
- Penguin UK, Pan Macmillan UK, Waterstones UK and Penguin Random House US have
  separate source identities. Images must pass the corresponding CDN/path guard.
- Market refers to the source/discovery branch; ISBN digits do not establish a country.
  Every query retains the selected ISBN. A different UK/US ISBN is never substituted.
- Penguin UK's WebPage.primaryImageOfPage is accepted only when the canonical
  product URL and jacket URL both bind to the selected ISBN.
- Waterstones may refuse automated page reads (403). Record the failure and continue;
  extraction and image acquisition remain subject to the same edition checks.

## Search order

A saved, registered edition page can be read first. Otherwise English-title discovery
tries UK ISBN, US ISBN, then the corresponding ISBN + title + author + publisher queries.
A known US product source changes the preferred order to US then UK. Chinese-title
discovery retains the global route. Bitmap Books remains a supported publisher.

Each response is ranked across up to eight results: approved publishers, retailers,
and then other leads, with explicit ISBN-path and source-market evidence.
Wrong ISBNs, wrong-market registered sources, unsafe URLs and duplicates are skipped.
At most three pages per query/eight total are attempted, with a shared 40-second
discovery deadline. A deadline/quota failure is not reported as a completed no-cover search.

## Diagnostics

In Book Bench open **操作診斷 → 匯出封面 Debug log**.
Schema version 2 / regional-cover-v1 retains the latest 500 session events.
Each server action has a runId; pair it with isbn when following one book.

Useful operations: cover.route, cover.discovery, cover.candidate, cover.source,
cover.page, cover.extract, cover.evidence, cover.image, cover.http,
cover.decode, cover.store and cover.prepare.

Events include regional keywords, result rank/score, source type, URLs, explicit
rejection codes, HTTP status and image dimensions. URL query strings and fragments
are removed; private notes, raw errors, authentication headers and API keys are not recorded.
A successful download is distinct from storage success and final shelf persistence.

## Verification

Live, source-URL-free discovery was checked with:
- 9780241968628: Chronicle of a Death Foretold, Penguin UK, 326 × 500.
- 9781035081288: Exit Party, Pan Macmillan UK, 1200 × 1930.
- 9780593321461: Exit Party, Penguin Random House US, 298 × 450.

These checks exercise real search, publisher recognition, edition checks and decoding.
They do not constitute an authenticated production shelf-write test.
