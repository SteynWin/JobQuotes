# JobQuotes

Quote kitchen and laundry cabinets: track jobs, material costs and labour, and build client quotes from your
Mozaik quantities. It's plain HTML/CSS/JS, so there's no build step and no server.

## Opening it

- **Hosted (recommended):** turn on GitHub Pages for this repository
  (**Settings → Pages → Deploy from a branch → `main` / root → Save**). After a
  minute, the app is at `https://<your-github-name>.github.io/<repo-name>/`.
  It works on phones as well.
- **On a computer:** download the repository (**Code → Download ZIP**), unzip it and
  double-click `index.html`.

The access code is **3622**. To change it, edit `ACCESS_CODE` in `access-gate.js`.

## Pages

- **Jobs**: every job with its status (Draft → Quoted → Accepted → In Progress
  → Completed / Lost), quote total, estimated cost and profit, and extra costs and variations.
- **Job**: quantities of materials and hardware grouped by category, labour
  hours (Labour / Machining / Assembly / Installation, plus Cutters per job) and add-ons (Design,
  Delivery…). The summary works out items total → margin % → subtotal → GST →
  total → deposit / balance, the same structure as Mozaik's pricing template,
  plus estimated cost and profit. Log supplier invoices, extra wages and
  site changes under **Extra costs and variations**. Each has your cost and an optional
  client charge; charged variations are added to the quote under **Variations**.
- **Quote**: a printable client quote, also downloadable as a PDF. You choose
  what the client sees: every item, quantities only, category totals, or just
  the total. The margin can be spread into the prices or shown as its own line.
- **Price List**: cost and sell price for every item, by category. Supports
  CSV import and export (Category, Item, Description, Unit, Cost, Price).
- **Labour Rates**: cost per hour against the rate charged (the only place labour rates can be changed), plus add-on presets.
- **Settings**: business details, overheads & margin %, GST and deposit %, quote
  numbering, terms, and backup / restore.

## Team sync

`firebase-config.js` points at a Firebase project. With real values filled in,
everyone who opens the link shares the same jobs and prices, live. The data is
kept in the `quoteBuilder` and `quoteJobs` collections. If the values are left as
placeholders, data is saved only in each person's own browser.

To give this app its own Firebase project, create one at
<https://console.firebase.google.com>, add a Firestore database and a web app,
and set the Firestore rules to:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}
```

Then paste the web app's six config values into `firebase-config.js`.
Anyone with the config could read or write the data directly. That is a
reasonable trade-off for a small internal tool, but worth knowing.
