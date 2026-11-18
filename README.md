# Knox Field Map

A shared Vue map for Project Zomboid. Drop a pin, enter a faction and its roster, and search by player or faction name to find every matching location. Select a search result to zoom to the pin and see its roster.

## Run locally

Use Node.js 22.13+ (prefer the latest supported LTS patch). In PowerShell, from the project directory:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The first run generates WebP tiles from your supplied map; subsequent runs reuse them. The original map files are unchanged.

The dev server automatically restarts when backend code changes. If you already had an older dev server running and a new feature says **Endpoint not found**, stop it with **Ctrl+C**, run `npm.cmd run dev` again, and refresh the page.

## Use the board

1. Select **Add marker**, then click or tap the map. Or use **Enter map coordinates** beside that button to place a pin by X/Y. These are coordinates on the supplied map (origin at the top left).
2. Enter the faction and its players, one name per line. Pick a **Marker color** for the pin and faction name, then save. You can change the color later by editing the marker.
3. Hover over a map marker to see its roster, with each player on a separate row. Search by full or partial name (case-insensitive), and use **Players** or **Factions** to limit the search. Selecting a result centers the map on that marker; use **Edit marker** to update its roster or delete it.

The board opens directly with no login. Anyone who can reach the site can view, add, edit, or delete markers. Other open browsers pick up changes within about eight seconds.

### Back up and restore markers

- **Download backup** saves a JSON file with all shared marker locations, faction names, rosters, and colors, even when search is active. Keep a copy somewhere safe outside the host.
- **Restore backup** opens a previously downloaded JSON file and shows how many markers it will add and how many current markers it will remove. Only **Replace markers** applies the restore. It replaces the entire shared board; download a fresh backup first if you want to keep the current state. Invalid files leave the board unchanged.

## Host it for your faction

Run `npm run build` and `npm start` on **one Node server**. A static-only host won't run the shared board API. The server listens on `127.0.0.1` by default; use an optional `.env` (see [`.env.example`](./.env.example)) to override the host or port. For faction access, put the entire site, including `/api`, on a private network or behind a proxy that restricts access to faction members. Don't expose the unlocked board to the public internet.

Markers are stored in SQLite at `data/markers.sqlite` by default. On a host with an ephemeral filesystem, set `DATABASE_PATH` to a file on a persistent local volume. Back up the database (stop the app first if copying files directly).

Run `npm test` for the HTTP integration and search checks.
