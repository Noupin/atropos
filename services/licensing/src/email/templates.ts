interface TransferEmailTemplateOptions {
  acceptUrl: string;
  deepLinkUrl: string;
  downloadUrl: string;
  expiresInMinutes: number;
}

interface EmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

export const createTransferEmailTemplate = (
  options: TransferEmailTemplateOptions,
): EmailTemplateResult => {
  const expiresLabel = options.expiresInMinutes === 1 ? "1 minute" : `${options.expiresInMinutes} minutes`;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Confirm your Atropos license transfer</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        background-color: #f7f7f8;
        color: #111827;
        padding: 0;
        margin: 0;
      }
      .container {
        max-width: 560px;
        margin: 0 auto;
        padding: 32px 24px;
        background-color: #ffffff;
      }
      h1 {
        font-size: 20px;
        margin-bottom: 16px;
      }
      p {
        line-height: 1.5;
        margin: 12px 0;
      }
      a.button {
        display: inline-block;
        padding: 12px 20px;
        margin: 20px 0;
        background-color: #111827;
        color: #ffffff !important;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
      }
      .note {
        font-size: 14px;
        color: #4b5563;
      }
      .code {
        font-family: "SFMono-Regular", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        word-break: break-all;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Confirm your license transfer</h1>
      <p>We received a request to move your Atropos license to a new device. Approve the transfer to continue using the app.</p>
      <p>
        <a href="${escapeHtml(options.acceptUrl)}" class="button">Open Atropos to approve transfer</a>
      </p>
      <p class="note">If the button doesn't open the desktop app, try the direct link:</p>
      <p class="code">
        <a href="${escapeHtml(options.deepLinkUrl)}">${escapeHtml(options.deepLinkUrl)}</a>
      </p>
      <p class="note">You can also copy and paste this URL into a browser if you're on the same computer:</p>
      <p class="code">
        <a href="${escapeHtml(options.acceptUrl)}">${escapeHtml(options.acceptUrl)}</a>
      </p>
      <p>This approval link expires in ${expiresLabel}.</p>
      <p class="note">
        Need the app on this device? <a href="${escapeHtml(options.downloadUrl)}">Download Atropos</a> and sign in with your account.
      </p>
      <p class="note">If you didn't request this, you can safely ignore the email.</p>
    </div>
  </body>
</html>`;

  const text = [
    "We received a request to move your Atropos license to a new device.",
    `Approve the transfer: ${options.acceptUrl}`,
    `Direct deep link: ${options.deepLinkUrl}`,
    `Download Atropos: ${options.downloadUrl}`,
    `This link expires in ${expiresLabel}.`,
    "If you didn't request this, ignore this email.",
  ].join("\n\n");

  return {
    subject: "Confirm your Atropos license transfer",
    html,
    text,
  };
};
