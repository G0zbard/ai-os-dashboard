# AI OS Dashboard

Responsive PWA deployed on Vercel.

## Live integrations
The server-side API uses Composio's tool execution API so OAuth tokens never reach the browser. Composio documents project API-key authentication and tool execution via `x-api-key`. See https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteByToolSlug.

### Vercel environment variables
Required:
- COMPOSIO_API_KEY (sensitive)
Optional overrides:
- COMPOSIO_GMAIL_ACCOUNT_ID
- COMPOSIO_DRIVE_ACCOUNT_ID

The frontend polls /api/state every 15 seconds and also opens /api/events for a short-lived SSE channel. This provides near-real-time updates while remaining resilient on serverless hosting.

Never commit API keys to Git.
