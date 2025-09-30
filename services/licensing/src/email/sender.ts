export interface EmailSenderEnv extends Record<string, unknown> {
  RESEND_API_KEY?: string;
}

export interface SendEmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM_ADDRESS = "Atropos <no-reply@atropos.app>";

interface ResendSuccessResponse {
  id: string;
}

interface ResendErrorResponse {
  name?: string;
  message?: string;
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

const parseApiKey = (env: EmailSenderEnv): string => {
  const apiKey = env.RESEND_API_KEY;

  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new EmailDeliveryError("RESEND_API_KEY is not configured");
  }

  return apiKey.trim();
};

export const sendEmail = async (
  env: EmailSenderEnv,
  payload: SendEmailPayload,
): Promise<ResendSuccessResponse> => {
  const apiKey = parseApiKey(env);

  const body: Record<string, unknown> = {
    from: payload.from ?? DEFAULT_FROM_ADDRESS,
    to: [payload.to],
    subject: payload.subject,
    html: payload.html,
  };

  if (payload.text) {
    body.text = payload.text;
  }

  if (payload.replyTo) {
    body.reply_to = payload.replyTo;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    const data = (await response.json()) as ResendSuccessResponse;
    return data;
  }

  let detail = await response.text();

  try {
    const parsed = JSON.parse(detail) as ResendErrorResponse;
    detail = parsed.message ?? JSON.stringify(parsed);
  } catch (error) {
    // ignore parse error and use raw text
  }

  throw new EmailDeliveryError(`Resend API error (${response.status}): ${detail}`);
};
