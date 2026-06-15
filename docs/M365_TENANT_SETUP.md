# Wiring RevenueTwin to a live Microsoft 365 / Azure tenant (S90)

This is the step-by-step to take RevenueTwin from offline-fallback mode (default, what
`make demo-offline` runs) to a LIVE Microsoft 365 Copilot + Work IQ + Foundry IQ integration.
Everything below is something the tenant owner (you) does once; the app then reads the values
from environment variables. RevenueTwin never stores secrets in the repo.

> If you do none of this, the product still runs and demos fully on synthetic data with the
> integration-health screen showing fallback mode. This guide is only to light up the LIVE path.

## What you need before starting
- An Azure subscription + an Entra ID (Azure AD) tenant where you are Global Admin (or can ask one).
- Microsoft 365 Copilot licensing on that tenant (required for Work IQ / Copilot surfaces).
- The Azure CLI installed (`az`) OR access to the Azure portal + Entra admin center.
- ~30 minutes.

## Step 1 - Register an Entra app (the agent identity)
Entra app registration is how RevenueTwin proves who it is to Microsoft Graph + Foundry IQ.

Portal route: Entra admin center (entra.microsoft.com) -> Applications -> App registrations
-> New registration. Name it `RevenueTwin`. Supported account types: single tenant. Register.

CLI route:
```
az login
az ad app create --display-name RevenueTwin --sign-in-audience AzureADMyOrg
```
From the result, record the **Application (client) ID** and your **Directory (tenant) ID**.

## Step 2 - Create a client secret (or, better, a certificate)
In the app -> Certificates & secrets -> New client secret. Copy the secret VALUE immediately
(it is shown once). For production prefer a certificate over a secret.
```
az ad app credential reset --id <APP_CLIENT_ID> --display-name revtwin-secret
```
Record the secret value. This is the one credential you must keep out of git (it goes in .env).

## Step 3 - Grant Microsoft Graph permissions (Work IQ ingestion)
RevenueTwin reads commercial intent from Outlook/Teams/SharePoint via Graph. In the app ->
API permissions -> Add a permission -> Microsoft Graph -> Application permissions, add the
least-privilege set:
- `Mail.Read` (QBR follow-up emails)
- `ChannelMessage.Read.All` (Teams meeting/chat commitments)
- `Sites.Read.All` (SharePoint contract docs)
- `OnlineMeetings.Read.All` (meeting metadata)

Then click **Grant admin consent for <tenant>** (requires Global Admin). This is the scope-consent
step the spec sec 10 refers to; RevenueTwin shows a scope-consent screen mirroring exactly these.

> Principle of least privilege: only add what a given pilot needs. Each scope maps to one Work IQ
> source in the integration-health screen, so a missing consent degrades that source visibly.

## Step 4 - Configure OIDC sign-in (already supported, S65)
RevenueTwin already has a real OIDC/Entra verifier. Point it at your tenant by setting:
- `OIDC_ISSUER` = `https://login.microsoftonline.com/<TENANT_ID>/v2.0`
- `OIDC_AUDIENCE` = `<APP_CLIENT_ID>`
- `OIDC_JWKS_URI` = `https://login.microsoftonline.com/<TENANT_ID>/discovery/v2.0/keys`
When these are set the app verifies real bearer tokens; unset, it uses the x-user-id demo shim.

## Step 5 - Foundry IQ (cited, permission-aware grounding)
Create a Microsoft Foundry project, attach a knowledge source (your contracts SharePoint), and
copy the project endpoint + key. Set:
- `FOUNDRY_ENDPOINT` = your Foundry project endpoint
- `FOUNDRY_API_KEY` = the project key (goes in .env, never git)
RevenueTwin uses Foundry IQ for cited contract retrieval; with it unset, the app falls back to the
local synthetic contract corpus and labels retrieval as fallback (citations still rendered).

## Step 6 - Register the M365 Copilot declarative agent
RevenueTwin ships a declarative-agent manifest (see `m365-agent/` after S90). Upload it via the
Microsoft 365 Agents Toolkit (VS Code) or Teams Developer Portal:
- Set the manifest `id` and your app `client ID`.
- Point the agent action API at your deployed RevenueTwin URL (`/api/...`).
- Sideload to your tenant, then invoke in Copilot: "show revenue risk for account Northwind".

## Step 7 - Put the values in .env (never in git)
Copy `.env.example` to `.env` and fill:
```
OIDC_ISSUER=https://login.microsoftonline.com/<TENANT_ID>/v2.0
OIDC_AUDIENCE=<APP_CLIENT_ID>
OIDC_JWKS_URI=https://login.microsoftonline.com/<TENANT_ID>/discovery/v2.0/keys
GRAPH_TENANT_ID=<TENANT_ID>
GRAPH_CLIENT_ID=<APP_CLIENT_ID>
GRAPH_CLIENT_SECRET=<SECRET_VALUE>
FOUNDRY_ENDPOINT=<your-foundry-endpoint>
FOUNDRY_API_KEY=<your-foundry-key>
```
`.env` is git-ignored. `deploy.sh` refuses to start if required secrets are missing/placeholder.

## The exact values to send me
If you want me to finish wiring S90 against your tenant, I need only these (the secret should be
delivered out-of-band, e.g. a password manager - do NOT paste it in chat or commit it):
1. Directory (tenant) ID
2. Application (client) ID
3. Confirmation that admin consent was granted for the Graph scopes in Step 3
4. Foundry endpoint (if using Foundry IQ live)

With those, the live path lights up; without them, the offline fallback + manifest still ship and
demo, honestly labeled as fallback per shared-standard B.2.
