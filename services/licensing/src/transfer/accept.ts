import { resolveDeepLinkScheme, resolveDownloadUrl, TransferEnvConfig } from "./common";

interface TransferAcceptEnv extends TransferEnvConfig {}

const htmlResponse = (content: string, status = 200): Response => {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
    },
  });
};

export const handleTransferAcceptView = (
  request: Request,
  env: TransferAcceptEnv,
): Response => {
  const url = new URL(request.url);
  const deviceHash = url.searchParams.get("device_hash")?.trim();
  const token = url.searchParams.get("token")?.trim();

  if (!deviceHash || !token) {
    return htmlResponse("<h1>Missing transfer parameters</h1>", 400);
  }

  const scheme = resolveDeepLinkScheme(env);
  const deepLink = `${scheme}://accept-transfer?device_hash=${encodeURIComponent(deviceHash)}&token=${encodeURIComponent(token)}`;
  const downloadUrl = resolveDownloadUrl(env);

  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapedDeepLink = escapeHtml(deepLink);
  const escapedDownloadUrl = escapeHtml(downloadUrl);

  const body = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open Atropos</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        color: #111827;
        margin: 0;
        padding: 40px 16px;
        background-color: #f7f7f8;
      }
      .container {
        max-width: 520px;
        margin: 0 auto;
        background: #ffffff;
        padding: 32px 24px;
        border-radius: 12px;
        box-shadow: 0 12px 30px rgba(17, 24, 39, 0.08);
        text-align: center;
      }
      h1 {
        font-size: 22px;
        margin-bottom: 16px;
      }
      p {
        font-size: 16px;
        line-height: 1.6;
        margin: 12px 0;
      }
      a.button {
        display: inline-block;
        margin: 24px 0;
        padding: 12px 20px;
        background-color: #111827;
        color: #ffffff;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
      }
      .muted {
        color: #6b7280;
        font-size: 14px;
      }
    </style>
    <script>
      window.addEventListener('load', function () {
        const target = ${JSON.stringify(deepLink)};
        window.location.href = target;
        setTimeout(function () {
          document.getElementById('manual-link').style.display = 'inline-block';
        }, 1500);
      });
    </script>
  </head>
  <body>
    <div class="container">
      <h1>Open Atropos to finish your transfer</h1>
      <p>We're opening the Atropos desktop app so you can approve this license transfer.</p>
      <p>
        <a id="manual-link" class="button" href="${escapedDeepLink}" style="display:none">Open Atropos</a>
      </p>
      <p class="muted">If nothing happens, click the button above or copy and paste this link into your browser:</p>
      <p class="muted"><code>${escapedDeepLink}</code></p>
      <p class="muted">Need the app on this device? <a href="${escapedDownloadUrl}">Download Atropos</a>.</p>
    </div>
  </body>
</html>`;

  return htmlResponse(body);
};
