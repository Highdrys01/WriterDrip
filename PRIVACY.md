# WriterDrip Privacy Policy

Last updated: 2026-04-06

## Summary

WriterDrip is designed to work locally in your browser. It does not send pasted text, document contents, or typing activity to a remote server.

## What WriterDrip Accesses

- Text that you paste into the extension popup
- The active tab when you explicitly invoke the extension
- The currently focused editor on the page when you start typing

## What WriterDrip Stores

WriterDrip stores the following data locally with `chrome.storage.local`:

- The draft text you entered for the current tab
- The duration value you entered for the current tab
- Active run state for each tab

This local data is used only to restore the popup and active session state for the tab you are working in.

## What WriterDrip Does Not Do

- It does not transmit your text to a backend service.
- It does not use analytics, ad trackers, or third-party SDKs.
- It does not sell or share your data with third parties.
- It does not read browsing activity in the background without you invoking the extension.
- It does not require an account, subscription, or paid access tier.
- It does not connect directly to your Google account in this open-source build.

## Permissions

- `activeTab`: lets WriterDrip access the current page only after you invoke the extension
- `scripting`: lets WriterDrip inject its content script into the current page after that user action
- `storage`: lets WriterDrip keep your draft text, duration, and active session state locally in the browser
- `alarms`: lets WriterDrip re-check active sessions for recovery

## Data Retention

Locally stored draft and session data remains in browser extension storage until you clear it, overwrite it, remove the extension, or the stored state is replaced by a newer session.

## Policy Scope

If you publish WriterDrip to the Chrome Web Store, keep this policy aligned with the actual extension behavior and link to the hosted version in the store listing.
