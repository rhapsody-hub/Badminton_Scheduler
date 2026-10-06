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


## Stable filenames

Use these same filenames for future updates:

- `index.html`
- `styles.css`
- `storage.js`
- `app.js`

Just overwrite the existing files in GitHub.


## Recovery fix

This build automatically repairs an invalid saved state where the browser has stored an empty member list.

It also uses hash-based tab navigation (`#members`, `#session`, `#matches`, `#attendance`) for more reliable navigation.

The actual filenames remain unchanged:

- `index.html`
- `styles.css`
- `storage.js`
- `app.js`

The query strings in `index.html` are only cache refresh parameters; they do not change the filenames you upload to GitHub.


## Player Match Counts

The Matches page now includes a compact player-count panel above the schedule.

- Each player shows their total scheduled match appearances for the current session.
- Counts update immediately after match generation or manual player changes.
- Players are ordered by match count, then name.
- The existing skill-tier color coding is retained.
- Counts include all scheduled matches, whether confirmed or unconfirmed.


## Generate / Reshuffle

Every press of **Generate / Reshuffle matches** now creates a new lineup.

The reshuffle still prioritizes:

- Fair match counts across players.
- Shorter waits between appearances.
- The selected Men's / Women's / Mixed match-mix preference.
- Reasonable skill composition.
- Avoiding repeated partners where possible.
- Reducing repeated opponent combinations where possible.

Randomness is used to break ties and select between similarly balanced options, so repeated Generate presses no longer reproduce the same schedule.


## Session History

The site can now save complete session snapshots to browser storage.

A saved session keeps:

- Session name
- Member list and skill levels
- Attendance
- Court count
- Session duration
- Rotation duration
- Match-mix preference
- Full generated / edited match list
- Confirmed status
- Completed status

Use **Save Session** from either Session or Matches.

The **Session History** tab shows previous saves and lets you:

- View session summary and player match counts
- Restore an old session as the current working session
- Delete one saved session
- Clear the full history

Resetting the current session does not erase Session History.

History is local to the current browser/device. A shared multi-device history would require a database/backend such as Supabase or Firebase.


## Clear Attendance

The Attendance & Live page now includes **Clear attendance**.

It marks every player absent and saves the updated attendance state immediately.

## Excel Export

The Matches page now includes **Export Excel**.

The browser downloads an Excel-compatible `.xls` file containing:

- Session name and settings
- Player list
- Gender
- Skill tier
- Player match counts
- Attendance
- Full match schedule
- Match type
- Skill profile
- Confirmed status
- Completed status

The export is generated entirely in the browser and does not require an external JavaScript library or backend.

# Shared multi-device setup with Supabase

This build supports one shared live workspace for multiple coordinators. When coordinators sign in and open the same workspace, the current member list, session settings, generated/edited schedule, confirmations, completed matches, attendance, and Session History are stored centrally and can be loaded on another device.

`localStorage` is still used as a local cache/fallback, but it is no longer the authoritative shared storage while a cloud workspace is active.

## One-time setup

1. Create a Supabase project.
2. Open **SQL Editor** and run all of `supabase-setup.sql`.
3. In **Authentication**, enable email sign-in / magic links.
4. In Supabase Authentication URL configuration, set your GitHub Pages URL as the Site URL and add the same address as an allowed Redirect URL.
5. In Supabase Project Settings / API, copy your **Project URL** and **Publishable key** (or anon key if your project still labels it that way).
6. Edit `config.js` and replace:
   - `YOUR_SUPABASE_URL`
   - `YOUR_SUPABASE_PUBLISHABLE_KEY`
7. Upload these files to GitHub:
   - `index.html`
   - `styles.css`
   - `config.js`
   - `storage.js`
   - `cloud.js`
   - `app.js`

Do **not** put a `service_role` key in `config.js`. Only the browser-safe publishable/anon key belongs there. Access is restricted with Supabase Auth and Row Level Security.

## First coordinator

1. Open the website.
2. Enter your coordinator email and request a sign-in link.
3. Open the link from the email.
4. Create a shared workspace.
5. The website shows an 8-character join code.
6. Share that join code only with your other coordinators.

## Additional coordinators

1. Open the same website on their device.
2. Sign in with their own email.
3. Enter the workspace join code.
4. Open the shared workspace.

They then load the same current session and shared history.

## Schedule behavior

Opening the website no longer automatically generates or reshuffles a schedule. A new lineup is created only when someone explicitly presses **Generate / Reshuffle matches**. This prevents a second device from accidentally creating a different schedule.

## Live collaboration

The current workspace state is stored in Supabase and subscribed through Supabase Realtime. A change by another coordinator can refresh the shared state on other connected devices.

The current architecture uses one JSON state row per workspace, so simultaneous edits use a last-write-wins model. This is suitable for a small coordinator team. If the project grows into heavy simultaneous editing, the data can later be normalized into separate Members, Matches, Attendance, and Sessions tables.


## Live match control update

The Matches page is now the main session-control screen.

### Match lifecycle

Matches now move through:

**Available → Playing → Completed**

A match cannot be marked complete directly from Available. It must be started first.

### Played counts

A player's Played count increases immediately when their match is started.

The match-count display is:

`Played / Scheduled`

If a Playing match is returned to Available with **Undo start**, those four Played counts decrease again.

### Available-match priority

Available matches require:

- Match is confirmed
- All four players are marked present
- None of the four players are currently playing

Available matches are sorted by the players' current Played counts. Matches containing players with fewer Played appearances are placed first.

### Court tracking

The Matches page includes **Courts Playing Now**. Each physical court shows the current match, players, and Complete button.

Before a match starts, its court can be changed from either:

- Available Matches
- Planned Schedule

If another unstarted match in the same planned rotation uses the selected court, the two court assignments are swapped.

A match cannot start if its selected physical court is already occupied by a Playing match.

### Player switching

Players can be changed before a match starts.

When the newly selected player is already scheduled in another unstarted match, the website prompts for which scheduled match should be used for the swap. The displaced player is moved into that selected match.

Players currently Playing cannot be moved.

### Attendance

Attendance has been moved into the Matches page. The separate Attendance & Live page/tab has been removed.

### Shared cloud behavior

All Playing status, start/completion state, court assignments, player swaps, attendance changes, and Played counts are part of the same shared workspace state and therefore sync through Supabase like the rest of the session.


## Compact member management

The Members page is now split into compact **Men** and **Women** lists.

Each list has its own search field. Search matches either member name or skill tier.

Each row now contains only:

- Name
- Skill tier
- Move to the other gender list
- Remove

Each group also has its own **+ Add** button.


## Master members vs session participants

The master **Members** page is now a reusable directory.

Each member has:

- Gender
- Skill tier
- Membership type: **Regular** or **Non-member**

The **Session** page has its own participant list. A person can remain in the master directory without being included in every badminton session.

Session participants are separated into **Men** and **Women**, with Regular / Non-member status shown on each row.

You can:

- Add an individual master member to the current session
- Add all Regular members at once
- Remove any participant from the current session
- Clear all session participants
- Search the Men and Women session lists separately

Removing someone from a session does **not** delete them from the master member directory.

When a participant is removed:

- Their attendance is cleared
- Their uncompleted / Playing matches are removed
- Completed matches are retained as historical records

Match generation, attendance, Available Matches, player swapping, player counts, and Excel export now use only the current session's participant list.

No Supabase migration is needed. `memberType` and `sessionMemberIds` are stored inside the existing shared JSON workspace state.


## Session participant UI refinement

The Session Participants panel now has a **Collapse / Expand** button.

The Men and Women add-member dropdowns use the full group width so names and status text are easier to read.


## Reusable Groups

The master member directory now supports reusable groups.

- Create as many groups as needed.
- A member can belong to multiple groups.
- Group membership is independent of Regular / Non-member status.
- Removing a group does not delete its members.
- Removing a member from the directory removes that member from every group.

Group data is stored inside the existing shared workspace JSON state, so no Supabase schema migration is required.

## Simplified Session workflow

New/reset sessions begin with an empty participant list.

The Session page is now:

1. Set session name, courts, duration, rotation, and match mix.
2. Choose a group and press **Import group**.
3. Import additional groups if required; duplicate members are ignored automatically.
4. Optionally add an individual person.
5. Expand the participant list only when you need to review or remove someone.
6. Generate matches.

Participants remain separated into Men and Women when the participant list is expanded.


## Separate Members and Groups pages

The navigation now has separate **Members** and **Groups** tabs.

### Members
The Members page is intentionally compact and only handles:

- Name
- Gender
- Skill tier
- Regular / Non-member status
- Add/remove members
- Search Men and Women separately

Group chips and group editing have been removed from the Members page.

### Groups
The Groups page contains all reusable group management:

- Create groups
- Rename groups
- Delete groups
- Search the member directory
- Add/remove members from each group
- The same member can belong to multiple groups

The Session page continues to import participants from these reusable groups.


## Group editor interaction fix

Two Group-page interaction issues were corrected:

1. Member search now filters the existing list in place instead of rebuilding the whole Group editor on every keystroke. The search field therefore keeps focus and the cursor no longer disappears.
2. Group membership checkboxes no longer trigger a full application re-render. This keeps checkbox positions stable while selecting several members and prevents missed / unreliable clicks.

Membership changes are still saved immediately and synchronized to the shared workspace.


## Simplified Session page

The Session page has been reduced to the controls used most often:

### Basic setup
- Session name
- Number of courts

### Participants
- Import a group
- Add an individual
- Participant counts
- Optional expandable Men / Women participant list
- Clear participants

### Advanced settings
Duration, rotation length, and match mix are now inside a collapsed **Advanced settings** section.

### Actions
The primary action is **Generate / Reshuffle matches**, followed by Save Session. Reset actions are visually secondary.

The previous session summary-card row was removed to reduce visual clutter.


## Advanced Settings dropdown readability fix

The Match Mix dropdown and the other Advanced Settings inputs now use:

- 40px control height
- horizontal-only internal padding
- explicit 14px text
- corrected line height

This prevents native select text from being vertically clipped in Microsoft Edge and similar browsers.


## Session date

Session creation now includes a **Session date** field.

The selected date is saved with the current session, synchronized through the shared workspace, included in saved Session History, restored with old sessions, and included in Excel exports.

New sessions default to the device's current local date.


## Participants and group-specific membership status

The **Members** page has been renamed **Participants**.

Regular / Non-member is no longer stored as an overall participant status in the UI. It is assigned independently inside each Group.

A participant can therefore be:

- Regular in Group A
- Non-member in Group B

When a Group is imported into a Session, its group-specific Regular / Non-member status is copied into the Session. If the same participant was already imported from another Group, the first imported status remains because duplicate participants are ignored.

Existing saved data is migrated automatically. Older global Regular / Non-member values are used as the initial status for existing Group memberships so current data is not lost.


## Group membership persistence fix

Participant-directory edits and Group membership are now fully independent.

Changing a participant's:

- Name
- Gender
- Skill tier

does not change which Groups they belong to and does not change their Group-specific Regular / Non-member status.

The internal fix preserves Group object identity during state normalization and Group checkbox/status handlers always update the current Group object before saving. This prevents stale editor references from overwriting or losing Group selections.


## Group selection save fix

Group membership is now committed in three layers:

1. Every checkbox / Regular-Non-member change saves immediately.
2. Before switching from one Group to another, the visible checkbox state is read directly from the page and written back to that Group.
3. Before leaving the Groups page, the visible Group is committed again as a fail-safe.

Cloud saving is also serialized and uses the exact state snapshot captured at the time of the edit. This prevents an older delayed save from replacing newer Group selections.

Changing participant name, gender, or skill tier does not modify Group membership.


## Production authentication redirect

Magic-link authentication now uses the explicit production redirect:

https://rhapsody-hub.github.io/Badminton_Scheduler/

This prevents a sign-in link from returning to localhost when the production website is used.

Supabase Dashboard must also allow this URL under Authentication > URL Configuration:

- Site URL: https://rhapsody-hub.github.io/Badminton_Scheduler/
- Redirect URL: https://rhapsody-hub.github.io/Badminton_Scheduler/
- Optional path wildcard: https://rhapsody-hub.github.io/Badminton_Scheduler/**


## Generate / Reshuffle behavior fix

Generate / Reshuffle now provides an explicit completion flow:

- The button shows **Generating…** while working.
- Fewer than 4 participants produces an error directly below the action buttons.
- Runtime generation errors are displayed directly on the Session page.
- Successful generation is saved immediately.
- Successful generation automatically opens the **Matches** page where the new schedule is visible.
- The success message includes generated match count and participant match-count range.

The scheduling fairness/randomization algorithm itself is retained.


## Live-linked Groups in Sessions

A Session no longer treats an imported Group as a one-time copy.

- Group membership changes update the current Session immediately.
- Removing Amy from a linked Group removes Amy from the current Session.
- Adding someone to a linked Group adds them to the current Session.
- Group-specific Regular / Non-member changes update the Session.
- If a person is still present through another linked Group, they remain in the Session.
- Individually added people remain independent.
- Removing a Group-derived person only from the Session creates a Session-only exclusion and does not edit the Group.
- Completed matches are preserved; uncompleted matches involving a removed participant are removed.

For older sessions, if the existing Session participant list exactly matches a Group before a Group edit, the app automatically recognizes that Group as the Session source.


## Simplified Matches page

The Matches page is now organized around live operation:

1. Compact status counters
2. **Playing Now**
3. **Up Next**
4. Collapsed Attendance
5. Collapsed Waiting / Blocked
6. Collapsed Player Match Counts
7. Collapsed Planned Schedule

This keeps upcoming playable matches near the top of the page instead of below the full attendance list.

Export Excel and Save Session remain at the top. Confirm/Unconfirm, Hide Completed, the skill legend, and the full rotation grid are now inside Planned Schedule.


## Fresh Session Generation

**Generate fresh matches** now rebuilds the current session from scratch before generating.

The source of truth is only:

- currently linked Groups
- individually added participants

Each generation now:

1. Clears old session-only participant exclusions.
2. Rebuilds participants from the currently linked Groups and individually added people.
3. Resets attendance for those participants.
4. Deletes the entire old match schedule, including Playing / Completed progress.
5. Generates a completely new schedule from the rebuilt participant list.

Session name, date, court count, duration, rotation length, and match-mix settings are retained.


## Add Individual dropdown fix

The **Add individual** dropdown is now calculated from the linked Groups instead of from the old/current Session participant snapshot.

It shows:

- every participant who is not a member of any currently linked Group
- excluding only people already added explicitly through **Add person**

Older session carry-over is no longer treated as an intentional individual selection when linked Groups are present. This prevents stale participants from disappearing from the dropdown.


## Generator source validation fix

The generator no longer clears the old session before checking whether the new source is valid.

Generation now:

1. Reads currently linked Groups and explicitly added individuals.
2. Shows a source summary on the Session page.
3. Requires at least 4 selected participants.
4. Displays a clear error when no Group/individual source is selected.
5. Only after validation succeeds does it delete the old match schedule and rebuild the fresh session.
6. The loading message is always replaced by success or a specific error.

Older cloud workspace states are also migrated before default values are merged, preventing missing source-tracking fields from silently becoming empty arrays.


## Cloud overwrite protection

The app now protects participant and Group data from stale/incomplete cloud copies.

Before applying an incoming cloud state, it compares:

- participant count
- Group count
- total Group-member assignments

If the cloud copy contains less directory/Group data than the current device, the cloud update is blocked and a conflict panel appears.

The coordinator can then choose:

- **Keep local & upload** — preserve this device's richer data and make it the shared cloud copy.
- **Use cloud copy** — explicitly accept the smaller cloud copy.

The app also stores up to 20 rolling local backups before cloud replacements/conflict decisions. This protection applies both when opening a workspace and to Realtime updates from other coordinators.


## Optional women's skill adjustment

Advanced Settings now includes **Apply women's skill adjustment (-0.25)**.

When enabled, the displayed tier stays unchanged, but the scheduler uses the tier's numeric score minus 0.25 for women when balancing teams and comparing match strength. Participation fairness and match-count priority are unchanged.

The option is enabled by default and saved per session.


## Women's skill adjustment refinement

The optional women's balancing modifier has been reduced from **-0.5** to **-0.25**.

Displayed skill tiers remain unchanged. Only the internal balancing score is adjusted.


## Matches-page reshuffle and women's skill adjustment

The women's balancing modifier has moved from Session to Matches.

Available radio choices:

- None
- -0.25
- -0.5
- -1.0

Changing the radio choice immediately regenerates / reshuffles the complete match schedule using the newly selected modifier.

The Matches page also has a dedicated **Reshuffle matches** button.

The adjustment is applied through one shared `effectiveSkillScore()` function. This function is used for player strength ordering, team pairing, match-balance scoring, and skill-profile calculations, so the selected value affects the actual schedule rather than only the display. Displayed participant tiers remain unchanged.

For backward compatibility, older boolean skill-adjustment states are migrated to either None or -0.25.


## Automatic physical court assignment

Available matches no longer require the coordinator to choose a court before starting.

Press **Start match** and the app assigns the first physically free court automatically. If all courts are occupied, the match remains waiting until a court becomes free.

The full Planned Schedule can still display/edit planned court assignments before a match starts, but live court placement is automatic.

## Approved coordinator emails

Coordinator access now uses a Supabase-backed email allowlist.

- The login box accepts an **Approved coordinator email**.
- The app checks Supabase before sending the secure sign-in link.
- Emails not present in the coordinator allowlist are rejected.
- Workspace create/join operations also verify that the signed-in email is still approved.
- A new **Coordinators** page lists approved emails and lets signed-in coordinators add or remove other coordinators.
- A coordinator cannot remove their own email through the page.

The connected Supabase project was migrated with the new coordinator table and RPC functions, and existing workspace members were used to seed the initial allowlist.


## Direct Supabase coordinator sign-in

Coordinator login now uses Supabase email/password authentication instead of magic links.

Flow:

1. Enter an approved coordinator email.
2. Enter its Supabase Auth password.
3. Press **Sign in**.
4. The app verifies the email is on the coordinator allowlist, then calls Supabase `signInWithPassword`.
5. No magic-link email is sent.

The **Coordinators** page also includes **Set / Change Password** for the coordinator currently signed in on that browser.

Important for existing magic-link-only accounts: Supabase does not automatically create a password for those users. If the browser still has an authenticated session, open Coordinators and set a password once. If there is no active authenticated session anywhere, that existing account will need one recovery/authentication step through Supabase before a password can be established.


## Visible coordinator sign-in feedback

Coordinator authentication now has a dedicated inline status panel next to the sign-in controls.

It shows:

- instructions before sign-in
- **Checking coordinator approval and signing in…**
- successful sign-in confirmation with the signed-in email
- missing-email / missing-password warnings
- unapproved coordinator warning
- incorrect email/password warning
- network / rate-limit / email-confirmation errors
- sign-out confirmation

The global application status remains available, but sign-in feedback no longer depends on the user noticing that separate status area.


## Verified coordinator password changes

The Coordinators page now requires all three fields before changing the signed-in coordinator's password:

1. Current password
2. New password
3. Confirm new password

The current password is not checked only in the browser. The app re-authenticates the signed-in coordinator against Supabase using the current email + current password. `updateUser({ password })` runs only after that verification succeeds.

The page reports incorrect current passwords, mismatched new-password confirmation, password-length validation, progress, and successful changes directly beside the password form.


## Coordinator credential management

### Add coordinator with password

Adding a coordinator now requires an email, an initial password, and password confirmation. The site calls the authenticated `badminton-coordinator-admin` Supabase Edge Function, which verifies the caller is an approved coordinator, creates/provisions the Supabase Auth user with the supplied password, confirms the Auth email, and adds the email to the coordinator allowlist.

The old password-less coordinator-add RPC is disabled for normal authenticated browser clients.

### Change another coordinator's password

The password tool now includes a coordinator selector. A signed-in coordinator can change any approved coordinator's password only when the selected coordinator's valid current password is supplied.

Verification uses a separate, non-persistent Supabase client so checking the other coordinator's credentials does not replace the main signed-in coordinator session.
