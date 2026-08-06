# STC Kuwait Live Device Dashboard

## Hostinger production deployment

This repository is ready to deploy as a Hostinger Node.js application for:

`https://devices.stcdigitalhub.com/`

Use these deployment settings:

- Repository: `https://github.com/thearjunks/AK02.git`
- Branch: `main`
- Node.js version: `20.x` (or any version compatible with `>=18.20.0`)
- Root directory: `./`
- Package manager: `npm`
- Install command: `npm install`
- Build command: leave empty
- Start command: `npm start`
- Entry file: `server.js`

Do not set `PORT` manually. Hostinger supplies it automatically. After deployment,
verify `https://devices.stcdigitalhub.com/health` returns a JSON response with
`"status":"ok"` before testing the dashboard and Excel download.

### One-click commit and deployment

Complete the GitHub connection in Hostinger once and enable Auto-deployment for
the `main` branch. After that, double-click `COMMIT & DEPLOY.cmd` whenever local
changes are ready. No additional input is required.

The command stages and commits all changes, pushes `main` to GitHub, waits for
Hostinger's automatic deployment, and verifies the exact new deployment through
the public `/health` endpoint. It opens the dashboard only after that release is
confirmed live.

### Automatic refresh and deployment

The Windows automation starts once every day at **10:00 AM Kuwait time**. It
automatically skips Fridays, Saturdays, Kuwait public holidays, and any date on
which a successful deployment has already completed.

Each working-day run fetches the latest STC data, validates the timestamp and
device totals, updates the dashboard snapshot, commits and pushes `main`, waits
for Hostinger auto-deployment, and verifies that the public website is serving
the exact new snapshot. Nothing is pushed when fetch or validation fails.

An email is sent to `thearjunks@gmail.com` for every stage:

1. Data Fetch Started
2. Data Fetch Completed
3. Dashboard Update Completed
4. GitHub Commit Started
5. GitHub Commit Completed
6. Hostinger Deployment Started
7. Hostinger Deployment Completed
8. Deployment Summary

Each message contains Kuwait time, run ID, status, details, and the audit-log
path. After a failure, all remaining stages are reported as `SKIPPED`. A skipped
weekend, holiday, or duplicate daily run is also reported by email.

The holiday guard refreshes Google's public **Holidays in Kuwait** calendar and
keeps a local cached copy. If the feed is unavailable and no cache exists, the
run fails closed and does not deploy.

One-time setup:

1. Enable Gmail two-step verification and create a Gmail App Password.
2. Double-click `SETUP AUTOMATION.cmd`.
3. Enter the Gmail sender address and the 16-character App Password.
4. Confirm that the test email arrives.

The credential is encrypted for the current Windows user and computer under
`%LOCALAPPDATA%\STCDeviceDashboard`. Automation logs, holiday cache, and the
last-successful-run marker are stored there. The computer must be on, Windows
must use the Kuwait timezone, and this Windows user must be signed in.

To run the same automation immediately, double-click `RUN AUTOMATION NOW.cmd`.

This app shows live STC Kuwait device information in a dashboard and lets you download the same data as an Excel file.

It can:

- Fetch all current STC devices live.
- Show more or fewer than 122 devices if STC changes the list.
- Show each device's Added Date and label current devices as `NEW` for 15 days, then `EXISTING`.
- Track removed products without resetting their original Added Date if they return.
- Keep removed devices in a dedicated `/removed-devices` history board.
- Show item group, item code, bilingual product content and URLs, prices, colors, storage, specs, plans, and zeed Price details.
- Download a fresh Excel report.

## Very Important

This is a **Node.js app**.

It is not only an HTML file.

Do not upload only this file:

```text
public/index.html
```

If you open only `public/index.html`, the UI may not load correctly and the live data will not work.

You must upload and run the full project with Node.js.

## Files In This Project

```text
README.md
package.json
package-lock.json
server.mjs
stc-service.mjs
excel-export.mjs
public/
  index.html
  app.js
  styles.css
```

## What The Main Files Do

```text
server.mjs
```

Runs the website and creates the API links.

```text
stc-service.mjs
```

Fetches live device data from STC.

```text
excel-export.mjs
```

Creates the Excel download file.

```text
public/index.html
public/app.js
public/styles.css
```

These files create the dashboard screen.

## Step 1: Install Node.js

You need Node.js version 18.20.0 or newer.

Download it from:

```text
https://nodejs.org/
```

After installing, open Command Prompt or Terminal and check:

```bash
node -v
npm -v
```

If both commands show version numbers, Node.js is installed.

## Step 2: Open The Project Folder

Open Terminal or Command Prompt inside this project folder.

The folder should contain:

```text
package.json
server.mjs
public/
```

## Step 3: Install The App Packages

Run:

```bash
npm install
```

This downloads the required packages, including the Excel generator.

You only need to run this once after uploading or copying the project.

## Step 4: Start The App

Run:

```bash
npm start
```

If it starts correctly, you should see something like:

```text
STC dashboard running at http://localhost:4177
```

## Step 5: Open The Dashboard

On your local computer, open:

```text
http://localhost:4177
```

Do not open:

```text
public/index.html
```

The correct page is served by the Node.js server.

## Step 6: Use The Dashboard

Click:

```text
Refresh live data
```

The app will fetch the latest STC device list.

Then you can:

- Search devices.
- Filter by status.
- Filter by category.
- Filter by brand.
- Click a row to see full details.
- Click `Download Excel` to download a fresh Excel report.

## Device Status Meaning

```text
NEW
```

The device first appeared in the monitored live eStore less than 15 days ago.

```text
EXISTING
```

The device is live and its Added Date is at least 15 days old.

```text
REMOVED
```

The device existed before, but it is missing from the latest STC live data.

## How Removed Device Tracking Works

After the first refresh, the app creates this file automatically:

```text
data/latest-snapshot.json
```

This file stores the last known device list.

On the next refresh, the app compares:

```text
previous saved list
current STC live list
```

That is how it knows which devices are added or removed. Each refresh samples
the complete eStore device block three times and combines unique product URLs
so a temporarily incomplete API response cannot hide newly published devices.

## Hosting The App

You need hosting that supports Node.js.

Examples:

- VPS server
- Render
- Railway
- Azure App Service
- AWS
- cPanel hosting with Node.js app support

Static hosting is not enough.

Static hosting examples that are usually not enough by themselves:

- Normal HTML upload only
- Basic file manager hosting
- GitHub Pages
- Netlify static-only setup

## Hosting Steps

1. Upload the full project folder to your hosting server.

2. Make sure these files are uploaded:

```text
package.json
server.mjs
stc-service.mjs
excel-export.mjs
public/
```

3. In your hosting terminal, run:

```bash
npm install
```

4. Start the app:

```bash
npm start
```

5. Open your hosted app URL.

For example:

```text
https://stcdigitalhub.com/device-informations/
```

Do not open:

```text
https://stcdigitalhub.com/device-informations/public/index.html
```

## If Your App Is Hosted Under A Folder

If your app is hosted under:

```text
/device-informations
```

and the API is also under the same folder, open:

```text
public/index.html
```

Find this part:

```html
<script>
  window.STC_API_BASE = window.STC_API_BASE || "";
</script>
```

Change it to:

```html
<script>
  window.STC_API_BASE = "/device-informations";
</script>
```

Then upload again.

## Links The Server Provides

When the Node app is running, these links should work:

```text
/                  Dashboard
/api/live-data      Live STC data
/api/download-report Excel download
```

If `/api/live-data` does not work, the dashboard cannot fetch live data.

## Common Problems

### Problem: Blank page or no UI

Possible reasons:

- Only `public/index.html` was uploaded.
- `app.js` or `styles.css` was not uploaded.
- The website is opened from the wrong URL.

Correct:

```text
https://your-domain.com/device-informations/
```

Wrong:

```text
https://your-domain.com/device-informations/public/index.html
```

### Problem: UI appears, but live data does not load

Possible reasons:

- Node server is not running.
- `/api/live-data` is not working.
- Hosting does not support Node.js.
- The app is hosted under a folder and `window.STC_API_BASE` needs to be changed.

### Problem: Excel download does not work

Possible reasons:

- Node server is not running.
- `/api/download-report` is not working.
- `npm install` was not run.

## Quick Test Checklist

After hosting, test these URLs:

```text
https://your-domain.com/device-informations/
```

You should see the dashboard.

```text
https://your-domain.com/device-informations/api/live-data
```

You should see JSON data.

```text
https://your-domain.com/device-informations/api/download-report
```

An Excel file should download.

## Need-To-Know Summary

Use this command to install:

```bash
npm install
```

Use this command to run:

```bash
npm start
```

Open the app through the Node server URL, not by opening `public/index.html` directly.
