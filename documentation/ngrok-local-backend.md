# Hosted dashboard and local ngrok backend

The Vite dashboard reads `VITE_API_BASE_URL` at build time. In the frontend
hosting environment, set it to the backend's ngrok HTTPS origin and rebuild and
redeploy the dashboard. Changing the laptop's frontend `.env` does not change an
existing hosted build. Leave `VITE_PUBLIC_BASE_URL` unset to inherit the API URL,
or update it to the same backend origin if it was explicitly configured.

On the laptop, set the backend's `PUBLIC_BASE_URL` to the same ngrok origin so
reporter links and local report-photo URLs remain publicly reachable. Restart
the backend after changing its environment or CORS configuration.

`CORS_ORIGINS` is an optional comma-separated list of browser client origins.
When set, it replaces the defaults. The defaults allow the Render dashboard at
`https://firetrackr-dashboard.onrender.com`, Vite at `http://localhost:5173`, and
Expo web at `http://localhost:8081` and `http://127.0.0.1:8081`. Add the exact
scheme, hostname and port of another browser client if needed, without a path.
The ngrok API destination is not the frontend's browser origin.

The middleware allows preflight requests for all methods and headers, including
`Authorization`, `Content-Type` and `ngrok-skip-browser-warning`. Dashboard and
mobile API clients already send the ngrok header. Existing authentication and
authorization remain required. Native Android HTTP requests are not subject to
browser CORS and do not need a synthetic app origin added to this list.

For the mobile app, set `EXPO_PUBLIC_API_BASE_URL` in the separate
`bfp_capstone_mobile/.env` to the same HTTPS origin before building. Expo embeds
the value in the JavaScript bundle; an installed standalone APK needs a rebuild
when that address changes. Its WebSocket URL is derived automatically as WSS.

Keep the API and ngrok running, with the laptop awake and online. An APK can run
without Metro, but it still needs internet access to reach the tunnel.
