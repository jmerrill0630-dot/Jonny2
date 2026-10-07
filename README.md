# Jonny.io — Vercel Multiplayer

Upload the CONTENTS of this folder to the root of your GitHub repository.

Expected GitHub root:

- api/
  - ws.mjs
- public/
  - index.html
  - client.js
  - engine.js
  - me.jpg
- engine.js
- package.json
- vercel.json

In Vercel:
1. Framework Preset: Other
2. Root Directory: ./
3. Build Command: leave as project setting/default, because vercel.json specifies `npm run build`
4. Output Directory: leave as project setting/default, because vercel.json specifies `dist`
5. Redeploy without cache after replacing the old files.

The browser connects to `/api/ws` for multiplayer.
