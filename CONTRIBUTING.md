# Contributing to WriterDrip

Thanks for helping improve WriterDrip.

## Before You Open a Pull Request

1. Keep the project free and open source.
2. Keep behavior local-first and privacy-conscious.
3. Avoid adding account requirements, paid tiers, trackers, or broad permissions unless there is a very strong reason.
4. Test changes in a real Google Doc if you touch typing or session behavior.

## Local Checks

Run these before submitting changes:

```sh
node --check background.js
node --check content.js
node --check popup.js
python3 -m json.tool manifest.json >/dev/null
```

## Pull Requests

- Explain what user problem your change solves.
- Keep the popup simple and easy to understand.
- Prefer safe failure over typing into the wrong field.
- Update `README.md` or `PRIVACY.md` when public behavior changes.

## Reporting Issues

- Include browser version, OS, and a short reproduction flow.
- Do not post private document contents or screenshots with sensitive text.
