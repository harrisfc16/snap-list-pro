# Architecture rules
- Keep deterministic listing normalization, platform formatting, and keyword recovery in a client-safe listing-rules module with focused tests, so all copied output obeys the same limits.
- Generate and freeze the item number with each server-produced listing rather than recomputing it from editable form fields, so descriptions and SKU copy remain consistent.
- Preserve the existing AI models and provider; retry only a successful response with malformed keywords once, not provider failures, so keyword repair does not amplify denied or rate-limited requests.