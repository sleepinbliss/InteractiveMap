# Knox Field Map

A Vue map for Project Zomboid. Anyone can view and search markers. With Supabase enabled, anyone can suggest a marker without an account. Only the board owner signs in to approve or reject suggestions, manage published markers, and restore backups.

## Set up the shared board on Supabase

1. Create a [Supabase project](https://supabase.com/dashboard) with the **Data API** enabled and `public` exposed. In **SQL Editor → New query**, paste and run the entire [`supabase/setup.sql`](./supabase/setup.sql). This creates the marker table, access policies, and admin restore function. Do not expose the `knox_private` schema in the Data API.
2. Leave the **Email** sign-in provider enabled, but turn off **Allow new users to sign up** in the project's Authentication settings. Under **Authentication → Users → Add user → Create new user**, create only your own account and enable **Auto Confirm User**. Public suggestions do not require enabling anonymous sign-ins in Supabase Auth.
3. Copy your **User UID** from the Users list. Run the following in Supabase's **SQL Editor**, replacing the sample UUID with your own:

   ```sql
   insert into knox_private.members (user_id, role) values
     ('00000000-0000-0000-0000-000000000001', 'admin')
   on conflict (user_id) do update set role = excluded.role;
   ```

   Only grant `admin` to yourself. If you already ran an older version of the setup script, run the updated script again before deploying. It preserves existing markers and your admin role, but previous `member` roles can no longer publish or edit.
4. In GitHub, go to **Settings → Secrets and variables → Actions → Variables → New repository variable**. Add both values from your Supabase project's **Connect** dialog or **Settings → API Keys**:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | The key beginning with `sb_publishable_` |

   The URL and publishable key are public in the browser. **Never use a secret or `service_role` key.** To test against Supabase locally, put the same two variables in an untracked `.env.local` and restart the editor. Without them, the editor continues using local SQLite.
5. Push this version to the default branch and let the `Publish faction map` workflow deploy, or run it manually after setting the variables. If Pages isn't configured already, set **Settings → Pages → Source → GitHub Actions**. The map stays on GitHub Pages; Supabase stores changes without a new GitHub deployment.
6. To bring over old markers, sign in as the admin and select **Restore backup** with your existing [`public/markers.json`](./public/markers.json) or a downloaded backup. The preview shows what will be replaced. Restored markers are admin-editable because backups do not contain account IDs. Keep dated backups: Supabase avoids Render's local-disk resets, but no database replaces an independent backup.

On the deployed map, anyone can use **Suggest marker → Submit for review** without signing in. As the owner, use **Admin sign in → Review submissions**, then choose **Approve and publish** or **Reject**. Suggestions stay private until approved. The queue holds up to 200 pending suggestions; since submissions are public, anyone can submit to it. Backups contain published markers only, and restoring one does not change the review queue.

Published marker locations, faction names, rosters, colors, and opaque marker owner IDs are public. Account emails and the admin access list are not exposed by the map.

## Run the editor locally without Supabase

Use Node.js 22.13+ (prefer the latest supported LTS patch). In PowerShell, from the project directory:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The first run generates WebP tiles from your supplied map; subsequent runs reuse them. The original map files are unchanged.

The dev server automatically restarts when backend code changes. If an older editor says **Endpoint not found**, stop the server with **Ctrl+C** in the terminal that originally started it, then run `npm.cmd run dev` and refresh the page. If the new terminal says port 5173 is already in use, the original server is still running.

## Edit and publish a static snapshot without Supabase

1. Select **Add marker**, then click or tap the map. Or use **Enter map coordinates** beside that button to place a pin by X/Y. These are coordinates on the supplied map (origin at the top left).
2. Enter the faction and its players, one name per input. A blank input appears as you fill the last row, and the list scrolls after four rows. Pick a **Marker color** for the pin and faction name, then save. You can change the color later by editing the marker.
3. Hover over a map marker to see its roster, with each player on a separate row. Search by full or partial name (case-insensitive), and use **Players** or **Factions** to limit the search. Selecting a result centers the map on that marker; use **Edit marker** to update its roster or delete it.

4. Click **Export for GitHub Pages** to download `markers.json`. The export reads all saved markers from the local editor, regardless of search filters. Replace [`public/markers.json`](./public/markers.json) with that file, then commit and push to the repository's default branch. Edits are not published until that push has deployed.

On a new machine, import the last published [`public/markers.json`](./public/markers.json) using **Restore backup** before editing so your export doesn't replace the existing board with an incomplete set. To bring over markers from Render, download a backup from Render and restore it in the local editor first.

### Back up and restore markers

- **Download backup** saves a dated JSON file with all marker locations, faction names, rosters, and colors, even when search is active.
- **Restore backup** previews the replacement and changes the editor's database only after you confirm. Invalid files leave the editor unchanged. To restore the public map, republish an older export or revert the marker-file commit on GitHub.

## Set up GitHub Pages once

1. In the GitHub repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**, not **Deploy from a branch**.
2. Push this version, including [`.github/workflows/pages.yml`](./.github/workflows/pages.yml), to the default branch. If you already pushed before changing the Pages setting, go to **Actions → Publish faction map → Run workflow** and select the default branch.
3. Wait for the workflow to finish, then open the Pages URL. The workflow builds Vue and the map tiles into `dist-pages` and publishes that folder. It deploys no API or database. Keep repository write access limited to yourself if you want to be the only publisher.

The published marker file and its repository history are public with the current public repository. Only publish faction names, players, and locations you intend to share publicly. GitHub Pages has no service to sleep or database to reset.

To preview the Pages build locally, run `npm run build:pages` then `npx vite preview --mode pages`. Use `npm run dev` for editing instead.

## Local editor storage

The editor uses `data/markers.sqlite` by default and binds to `127.0.0.1`. Keep it local: its editing API has no login. The local database is separate from the public snapshot and is never deployed by the Pages workflow.

Run `npm test` for the HTTP integration and search checks.
