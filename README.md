# Badminton Session Manager

Static badminton session manager with browser `localStorage` persistence.

## What is saved automatically

The app now saves these items in the current browser:

- Members
  - Name
  - Gender
  - Skill tier
- Attendance status
- Number of courts
- Session duration
- Rotation duration
- Match-mix setting
- Generated matches
- Manual match edits
- Confirmed / unconfirmed status
- Completed / incomplete status

Refreshing or closing the browser no longer resets the session.

## Files

- `index.html`
- `styles.css`
- `storage.js`
- `app.js`

## How persistence works

`storage.js` owns the browser-storage layer.

The localStorage key is:

```text
badmintonSessionManagerState
```

The saved data is versioned so future app changes can migrate or ignore incompatible older data safely.

## Resetting saved data

Go to **Session** and use:

**Reset saved data**

This clears the localStorage record and restores the default member list.

## Important limitation

`localStorage` is specific to the browser/device/domain.

For example:

- Chrome on Laptop A does not automatically share data with Chrome on Laptop B.
- Your GitHub Pages site and a local `file://` copy do not necessarily share storage.
- Clearing browser site data will remove saved sessions.

For shared multi-device data, the next upgrade should use a backend such as Supabase or Firebase.

## Run locally

You can open `index.html` directly.

Or run:

```bash
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## GitHub Pages

Upload all four web files to the repository root:

- `index.html`
- `styles.css`
- `storage.js`
- `app.js`

Then enable GitHub Pages from the repository settings.


## Compact color-coded match board

The Matches tab has been redesigned into a rotation-based board:

- Courts are grouped under each rotation.
- All 3 simultaneous courts can be scanned together on desktop.
- Player selectors are directly color-coded by skill tier.
- A+/A share the blue family, B+/B share the green family.
- C, D, and unknown tiers use progressively softer yellow, peach, and gray.
- Confirm and Done controls remain available on each court.
- Matches remain fully editable.
- The layout collapses cleanly for tablet and mobile screens.


## Excel-style Matches view

The Matches page now uses a dense spreadsheet-style table:

- One row per match.
- Sticky column headers.
- Internal scrolling so the whole page stays compact.
- Rotation boundaries are marked by stronger horizontal lines.
- Player cells are directly color-coded by skill.
- Confirm and Done are simple checkbox columns.
- Optional **Hide completed** filter.
- Manual player editing still works from each row.


## V3 rotation spreadsheet

The Matches page now uses a true rotation grid:

- One row per rotation instead of one row/card per match.
- Court 1, Court 2, Court 3, etc. appear side-by-side.
- A standard 3-court / 10-rotation session uses only 10 table rows.
- Each court cell contains both teams and remains editable.
- Player selectors retain the skill-tier colors.
- Confirm and Done are compact C / D checkboxes inside each court.
- The stylesheet and JavaScript use versioned filenames (`styles-v3.css`, `app-v3.js`) to avoid old GitHub Pages/browser cache collisions.


## V4 layout changes

- Removed the Time column from the Match Schedule.
- Match dropdowns display player names only; tiers are represented by color.
- Player name text is smaller so longer names fit more reliably.
- Attendance no longer displays tier labels.
- Attendance and Live player names still use the same skill-tier colors.
- Versioned asset filenames (`styles-v4.css`, `storage-v4.js`, `app-v4.js`) avoid stale GitHub Pages/browser caches.


## V5 changes

- Added **Unconfirm all** next to **Confirm all**.
- Removed the internal vertical scrollbar from the Match Schedule.
- The full schedule now expands naturally down the page.
- The browser/page scrollbar is now used for vertical scrolling.
- Horizontal scrolling is only used when the screen is too narrow for all courts.
