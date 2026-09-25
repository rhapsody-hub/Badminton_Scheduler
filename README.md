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
