# Search Console Users And Permissions

Phase 34 documents the recommended access model for the `commanderzone.com` Google Search Console property.

## Access Model

Use the least privilege that still lets each person do their job.

| Role | Recommended owner/user | Purpose |
| --- | --- | --- |
| Verified owner | Project/domain owner | Holds primary ownership through domain verification and must remain active. |
| Delegated owner | Trusted technical owner, if needed | Can manage verification and users when the project/domain owner is unavailable. |
| Full user | SEO or marketing lead, if needed | Can review data and use operational Search Console features without owning the property. |
| Restricted user | Read-only collaborators, if needed | Can inspect reports without changing settings or access. |

## Ownership Rules

- At least one verified owner must remain active at all times.
- Do not use personal-only credentials as the single access point.
- If ownership changes, add and verify the new owner before removing the previous owner.
- Avoid giving owner access when full or restricted access is enough.
- Remove access promptly when a collaborator no longer needs it.

## Quarterly Access Review

Every quarter:

- Confirm at least one verified project/domain owner still has access.
- Confirm delegated owners are still trusted and necessary.
- Review full users and downgrade/remove access that is no longer needed.
- Review restricted users and remove inactive collaborators.
- Confirm no former contractor, agency, or employee still has unnecessary access.
- Confirm no single personal account is the only way to access the property.
- Record the review date, reviewer, and any access changes made.

## Scope Boundary

This phase does not create post-deploy checks, submit sitemaps, inspect URLs, or configure Search Console dashboards. Those are separate phases.
