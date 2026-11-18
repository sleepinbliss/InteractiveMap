# Knox Field Map

A public, read-only Vue map for Project Zomboid. Visitors can search for factions and players, click results to zoom to a pin, and hover over pins to see rosters. Use the local editor to make changes and publish a new marker snapshot through GitHub.

## Run the editor locally

Use Node.js 22.13+ (prefer the latest supported LTS patch). In PowerShell, from the project directory:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The first run generates WebP tiles from your supplied map; subsequent runs reuse them. The original map files are unchanged.

The dev server automatically restarts when backend code changes. If an older editor says **Endpoint not found**, stop the server with **Ctrl+C** in the terminal that originally started it, then run `npm.cmd run dev` and refresh the page. If the new terminal says port 5173 is already in use, the original server is still running.

## Edit and publish markers

1. Select **Add marker**, then click or tap the map. Or use **Enter map coordinates** beside that button to place a pin by X/Y. These are coordinates on the supplied map (origin at the top left).
2. Enter the faction and its players, one name per line. Pick a **Marker color** for the pin and faction name, then save. You can change the color later by editing the marker.
3. Hover over a map marker to see its roster, with each player on a separate row. Search by full or partial name (case-insensitive), and use **Players** or **Factions** to limit the search. Selecting a result centers the map on that marker; use **Edit marker** to update its roster or delete it.

4. Click **Export for GitHub Pages** to download `markers.json`. The export reads all saved markers from the local editor, regardless of search filters. Replace [`public/markers.json`](./public/markers.json) with that file, then commit and push to the repository's default branch. Edits are not published until that push has deployed.

On a new machine, import the last published [`public/markers.json`](./public/markers.json) using **Restore backup** before editing so your export doesn't replace the existing board with an incomplete set. To bring over markers from Render, download a backup from Render and restore it in the local editor first.

### Back up and restore markers

- **Download backup** saves a dated JSON file with all marker locations, faction names, rosters, and colors, even when search is active.
- **Restore backup** previews the replacement and changes the editor's database only after you confirm. Invalid files leave the editor unchanged. To restore the public map, republish an older export or revert the marker-file commit on GitHub.

## Set up GitHub Pages once

1. In the GitHub repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**, not **Deploy from a branch**.
2. Push this version, including [`.github/workflows/pages.yml`](./.github/workflows/pages.yml), to the default branch. If you already pushed before changing the Pages setting, go to **Actions → Publish read-only faction map → Run workflow** and select the default branch.
3. Wait for the workflow to finish, then open the Pages URL. The workflow builds Vue and the map tiles into `dist-pages` and publishes that folder. It deploys no API or database. Keep repository write access limited to yourself if you want to be the only publisher.

The published marker file and its repository history are public with the current public repository. Only publish faction names, players, and locations you intend to share publicly. GitHub Pages has no service to sleep or database to reset.

To preview the Pages build locally, run `npm run build:pages` then `npx vite preview --mode pages`. Use `npm run dev` for editing instead.

## Local editor storage

The editor uses `data/markers.sqlite` by default and binds to `127.0.0.1`. Keep it local: its editing API has no login. The local database is separate from the public snapshot and is never deployed by the Pages workflow.

Run `npm test` for the HTTP integration and search checks.
