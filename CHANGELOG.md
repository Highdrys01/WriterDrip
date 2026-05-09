# Changelog

WriterDrip uses simple semantic versions so users and contributors can tell exactly what changed between updates.

## 1.0.3 - 2026-05-08

- Added visible versioning in the popup footer.
- Added this changelog as the source of truth for user-facing updates.
- Hardened MV3 recovery with scoped Google Docs document access for resume/reload recovery.
- Fixed a resume reliability issue where a recoverable pause could return to `running` without restarting the typing loop.
- Improved manual-interaction safety so user typing is blocked before it can drift the active run.
- Made keep-awake reconciliation safer after background worker restarts.
- Reduced debug report fingerprinting by replacing full user-agent strings with browser family/version.
- Clarified privacy and permission docs around Google Docs document access and optional keep-awake behavior.

## 1.0.2 - 2026-05-08

- Added optional `Keep computer awake` control for active local runs.
- Improved background typing behavior while using other tabs.
- Added recovery and debug-report polish for safer pause/resume flows.

## 1.0.1 - 2026-04-28

- Expanded correction intensity behavior and preview estimates.
- Added stronger delayed repairs, typo variety, and draft-aware duration recommendations.
- Improved README and GitHub Pages install guidance.

## 1.0.0 - 2026-04-07

- Initial open-source WriterDrip release.
- Local-only Chrome extension for paced typing into Google Docs.
- Included custom duration, correction intensity, pause/resume, and same-Doc binding.
