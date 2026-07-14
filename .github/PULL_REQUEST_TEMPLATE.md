> **SOC2 note:** every PR must have either (a) a ticket reference, or (b) enough
> context in the description to justify the change on its own. The reviewer
> is responsible for validating that before approving.

## Summary

1-3 sentences: what changes and why. For non-trivial changes, include
the user-visible or operational impact.

## Ticket / Work Item

Link the Jira / Linear / GitHub issue. If there is no ticket, write
"No ticket" and use the Justification section to explain why this change
stands on its own (e.g. trivial typo fix, urgent prod hotfix with incident
link, dependency bump from Dependabot).

-

## Justification

Why now? What problem does this solve, or what risk does it reduce?
Skip if the ticket already covers it.

## Testing

How was this validated? Unit tests, manual repro steps, staging deploy,
etc. "CI is green" alone is not sufficient for changes that touch behavior.

- [ ] Unit / integration tests added or updated
- [ ] Manually verified — describe how:
- [ ] No tests needed — explain why (e.g. docs-only change, comment cleanup):

## Rollout / Rollback

Only required for changes that touch prod behavior, config, schemas,
or external integrations. Delete this section for pure refactors / tests.

- Rollout:
- Rollback:

---

## Reviewer Checklist (SOC2)

The authorized reviewer confirms, before approving, that:

- [ ] The description, ticket reference, and justification are sufficient to understand the change without asking the author.
- [ ] Tests exist for the new/changed behavior, or the author has justified why none are needed.
- [ ] The change is in scope — no unrelated edits sneaking in.
- [ ] Security-sensitive surfaces (auth, secrets, external webhooks, SQL, IAM) got an extra look if touched.
