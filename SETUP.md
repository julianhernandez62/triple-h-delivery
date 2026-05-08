# Triple H Delivery — AI Quote System Setup

## Overview
When a client submits the form, the system will:
1. Send the job details to Claude AI, which generates a structured price estimate
2. Email the full quote to julian.hernandez@triplehdelivery.com
3. Log every submission to a Google Sheet

---

## Step 1 — Revoke your exposed API key

1. Go to https://console.anthropic.com/settings/keys
2. Delete the key that was shared publicly
3. Click **Create Key** to generate a new one
4. Copy the new key — you'll need it in Step 3

---

## Step 2 — Create a Google Sheet for logging

1. Go to https://sheets.google.com and create a new blank spreadsheet
2. Name it "Triple H Delivery Quotes" (or anything you like)
3. Copy the **Spreadsheet ID** from the URL:
   - URL looks like: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
   - The ID is the long string between `/d/` and `/edit`

---

## Step 3 — Update your Google Apps Script

1. Go to https://script.google.com
2. Open your existing project (the one connected to your site), or create a new one
3. Delete all existing code in `Code.gs`
4. Paste the entire contents of `Code.gs` from this folder
5. Click **Project Settings** (gear icon on the left sidebar)
6. Scroll down to **Script Properties** and click **Add script property**
7. Add these two properties:

   | Property name      | Value                          |
   |--------------------|-------------------------------|
   | ANTHROPIC_API_KEY  | (your new API key from Step 1) |
   | SPREADSHEET_ID     | (the Sheet ID from Step 2)     |

8. Click **Save script properties**

---

## Step 4 — Deploy the Apps Script

1. In the Apps Script editor, click **Deploy → New deployment**
2. Click the gear icon next to "Select type" and choose **Web app**
3. Set these options:
   - Description: `Triple H Delivery Quote Engine v2`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Copy the **Web app URL** — it looks like:
   `https://script.google.com/macros/s/XXXXXXXXXX/exec`

---

## Step 5 — Update your website form

Open `index.html` in your GitHub repository and follow the instructions in `form-changes.md`:
1. Replace the form HTML (adds email + destination fields)
2. Replace the JavaScript submit handler (paste your new Web app URL)

Commit and push to GitHub — GitHub Pages will update automatically.

---

## Step 6 — Test it

1. Visit your live site
2. Fill out the form with test data
3. Within ~10 seconds you should receive an email at julian.hernandez@triplehdelivery.com
4. Check your Google Sheet — a new row should appear

---

## Adjusting your pricing

All pricing rates are in `Code.gs` at the top in the `PRICING_CONFIG` object.
Change any value there, save, and redeploy (Deploy → Manage deployments → Edit → Version: New version → Deploy).

```
minimumCharge: 150       ← Minimum job charge ($)
baseHourlyRate: 75       ← $/hr for 2-helper crew
extraHelperRate: 40      ← $/hr per extra helper
mileageRate: 2.50        ← $/mile for trips over 10 miles
heavyItemSurcharge: 75   ← Per piano/safe/appliance
stairsSurcharge: 25      ← Per flight of stairs
```
