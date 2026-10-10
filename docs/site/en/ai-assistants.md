# Connecting an AI assistant

You can connect an MCP-compatible AI assistant (Claude, for example) to your Comprobify account and ask it about your documents and issuers in conversation. The assistant acts on your behalf, through your own sign-in, and is **read-only**: it cannot create, change or void anything.

It is available on **every plan**, including FREE. You don't need an API key, and none is ever shown to you.

## What the assistant can see

- **Your electronic documents**: list them and look up their status and details.
- **Your issuers**: branches, issue points and their details.

It sees what you see in the web app. If your user only has access to certain issuers, the assistant only sees those.

## How to connect it

1. In your assistant, add an MCP server (or "connector") with this address:

   ```
   https://comprobify.com/mcp
   ```

2. Your browser opens the Comprobify web app. Sign in if you haven't already.
3. Review the authorization screen: it shows which application is asking, for which account, and what it will be able to do. Click **Allow**.
4. You are returned to the assistant, now connected.

You only ever sign in to Comprobify. Your password never reaches the assistant.

::: warning Only authorize what you started
The name on the authorization screen is declared by the application itself and is not verified. Continue only if you just started the connection from your assistant. If the screen appears without you asking for it, click **Cancel**.
:::

## Revoking access

In the web app, go to **Settings › Connected apps**. Each connected application is listed with when you connected it and when it was last used. Click **Revoke access** and it stops working immediately.

Access also ends by itself if your user is removed from the account or disabled, or if your role changes and no longer covers what you had authorized.

## Authorizing again

Every so often Comprobify asks you to confirm the authorization again, even if you revoked nothing. This is deliberate: an approval does not stay valid forever.

## If you want to build your own integration

This connection is for querying your account from an assistant. To integrate your own system (issuing documents from your ERP, receiving webhooks), use the API with an API key, available from the STARTER plan. See [Getting Started](getting-started.md) and [Manage API keys](endpoints/api-keys.md).
