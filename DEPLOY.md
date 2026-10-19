# Static GitHub Pages version

This folder is the static WebRTC-only version of the app. It is designed to work from GitHub Pages without a Node.js backend.

## What is included
- static HTML + JS site
- WebRTC direct transfer using a public STUN server
- manual SDP signaling through copy/paste of offer/answer messages
- ready for GitHub Pages hosting

## Best deployment option

For a public URL, the best free path is:
1. Push this folder to a GitHub repository.
2. Enable GitHub Pages in the repository settings.
3. Publish from the main branch or the docs folder.

This works for static front-end hosting. It does not require a backend.

## Important limitation

A pure static site does not have a built-in signaling server. That means a direct WebRTC connection still needs a way to exchange the offer/answer negotiation. This version uses manual copy/paste as the simplest, zero-backend solution.

## For true remote access between any two users

If you want a smoother public experience where users do not have to copy SDP text manually, the better remote setup is:
- GitHub Pages for the front-end
- Firebase or Supabase for signaling
- public STUN servers for NAT traversal

This keeps the site static while moving only the signaling to a hosted service.

## Local test

Serve the folder locally with any static server, for example:

```bash
cd static-site
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Open the page in two tabs or two browsers and complete the offer/answer flow.
