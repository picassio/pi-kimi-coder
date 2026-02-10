/**
 * Kimi Coder Provider Extension for Pi
 *
 * Adds support for the Kimi K2 Coding plan, using OAuth device flow
 * authentication via https://auth.kimi.com.
 *
 * Features:
 * - OAuth device flow login via `/login kimi-coder`
 * - Auto-imports existing kimi-cli tokens from ~/.kimi/credentials/kimi-code.json
 * - Automatic token refresh
 * - Models: kimi-for-coding (powered by kimi-k2.5), kimi-k2.5
 *
 * Usage:
 *   pi install /path/to/pi-kimi-coder
 *   pi /login kimi-coder      # or skip if you already logged in with kimi-cli
 *   pi /model kimi-coder/kimi-for-coding
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Constants
// =============================================================================

const KIMI_CODE_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const OAUTH_HOST = "https://auth.kimi.com";
const BASE_URL = "https://api.kimi.com/coding/v1";
const PROVIDER_NAME = "kimi-coder";

// Path where kimi-cli stores its OAuth credentials
const KIMI_CLI_CREDENTIALS_PATH = path.join(
  os.homedir(),
  ".kimi",
  "credentials",
  "kimi-code.json"
);

// Path where pi stores OAuth credentials
const PI_AUTH_PATH = path.join(os.homedir(), ".pi", "agent", "auth.json");

// =============================================================================
// Token Management — shared with kimi-cli
// =============================================================================

interface KimiToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
}

function loadKimiCliToken(): KimiToken | null {
  try {
    if (!fs.existsSync(KIMI_CLI_CREDENTIALS_PATH)) return null;
    const raw = fs.readFileSync(KIMI_CLI_CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (data.access_token && data.refresh_token) {
      return data as KimiToken;
    }
    return null;
  } catch {
    return null;
  }
}

function saveKimiCliToken(token: KimiToken): void {
  try {
    const dir = path.dirname(KIMI_CLI_CREDENTIALS_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      KIMI_CLI_CREDENTIALS_PATH,
      JSON.stringify(token),
      { encoding: "utf-8", mode: 0o600 }
    );
  } catch {
    // Silently fail
  }
}

/**
 * Seed pi's auth.json with kimi-cli credentials so /login is not required
 * if the user already authenticated with kimi-cli.
 */
function seedPiAuthFromKimiCli(): boolean {
  const token = loadKimiCliToken();
  if (!token || !token.access_token) return false;

  // Check if token is still valid (at least 60s remaining)
  if (token.expires_at < Date.now() / 1000 + 60) return false;

  try {
    let authData: Record<string, any> = {};

    if (fs.existsSync(PI_AUTH_PATH)) {
      const raw = fs.readFileSync(PI_AUTH_PATH, "utf-8");
      authData = JSON.parse(raw);
    }

    // Check if already seeded with a valid token
    const existing = authData[PROVIDER_NAME];
    if (
      existing &&
      existing.type === "oauth" &&
      existing.access &&
      existing.expires > Date.now()
    ) {
      return true; // Already has valid credentials
    }

    // Seed from kimi-cli
    authData[PROVIDER_NAME] = {
      type: "oauth",
      refresh: token.refresh_token,
      access: token.access_token,
      expires: token.expires_at * 1000, // Pi stores in ms
    };

    const dir = path.dirname(PI_AUTH_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PI_AUTH_PATH, JSON.stringify(authData, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });

    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// OAuth Device Flow
// =============================================================================

interface DeviceAuthorization {
  user_code: string;
  device_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number | null;
  interval: number;
}

async function requestDeviceAuthorization(): Promise<DeviceAuthorization> {
  const response = await fetch(
    `${OAUTH_HOST}/api/oauth/device_authorization`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: KIMI_CODE_CLIENT_ID }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Device authorization failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as any;
  return {
    user_code: String(data.user_code),
    device_code: String(data.device_code),
    verification_uri: String(data.verification_uri || ""),
    verification_uri_complete: String(data.verification_uri_complete),
    expires_in: data.expires_in ? Number(data.expires_in) : null,
    interval: Math.max(Number(data.interval || 5), 1),
  };
}

async function pollForToken(auth: DeviceAuthorization): Promise<KimiToken> {
  const maxAttempts = auth.expires_in
    ? Math.ceil(auth.expires_in / auth.interval)
    : 120;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, auth.interval * 1000));

    const response = await fetch(`${OAUTH_HOST}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KIMI_CODE_CLIENT_ID,
        device_code: auth.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await response.json()) as any;

    if (response.status === 200 && data.access_token) {
      const expiresIn = Number(data.expires_in || 3600);
      return {
        access_token: String(data.access_token),
        refresh_token: String(data.refresh_token),
        expires_at: Date.now() / 1000 + expiresIn,
        scope: String(data.scope || "kimi-code"),
        token_type: String(data.token_type || "Bearer"),
      };
    }

    const error = String(data.error || "");
    if (error === "expired_token") {
      throw new Error("Device code expired. Please try again.");
    }
    // authorization_pending or slow_down — keep polling
  }

  throw new Error("Login timed out. Please try again.");
}

async function refreshAccessToken(refreshToken: string): Promise<KimiToken> {
  const response = await fetch(`${OAUTH_HOST}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: KIMI_CODE_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = (await response.json()) as any;

  if (!response.ok) {
    throw new Error(
      data.error_description || `Token refresh failed (${response.status})`
    );
  }

  const expiresIn = Number(data.expires_in || 3600);
  return {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    expires_at: Date.now() / 1000 + expiresIn,
    scope: String(data.scope || "kimi-code"),
    token_type: String(data.token_type || "Bearer"),
  };
}

// =============================================================================
// Pi OAuth Adapter
// =============================================================================

async function loginKimiCoder(
  callbacks: OAuthLoginCallbacks
): Promise<OAuthCredentials> {
  // First, check if kimi-cli already has valid tokens
  const existing = loadKimiCliToken();
  if (
    existing &&
    existing.access_token &&
    existing.expires_at > Date.now() / 1000 + 60
  ) {
    return {
      refresh: existing.refresh_token,
      access: existing.access_token,
      expires: existing.expires_at * 1000,
    };
  }

  // Start device flow
  const auth = await requestDeviceAuthorization();

  // Show device code to user — pi will open the browser
  callbacks.onDeviceCode({
    userCode: auth.user_code,
    verificationUri:
      auth.verification_uri_complete || auth.verification_uri,
  });

  // Poll for token
  const token = await pollForToken(auth);

  // Save for kimi-cli interop
  saveKimiCliToken(token);

  return {
    refresh: token.refresh_token,
    access: token.access_token,
    expires: token.expires_at * 1000,
  };
}

async function refreshKimiCoderToken(
  credentials: OAuthCredentials
): Promise<OAuthCredentials> {
  // Also check disk — kimi-cli might have refreshed it already
  const diskToken = loadKimiCliToken();
  if (
    diskToken &&
    diskToken.access_token !== credentials.access &&
    diskToken.expires_at > Date.now() / 1000 + 300
  ) {
    return {
      refresh: diskToken.refresh_token,
      access: diskToken.access_token,
      expires: diskToken.expires_at * 1000,
    };
  }

  const token = await refreshAccessToken(credentials.refresh);

  // Save for kimi-cli interop
  saveKimiCliToken(token);

  return {
    refresh: token.refresh_token,
    access: token.access_token,
    expires: token.expires_at * 1000,
  };
}

function getApiKey(credentials: OAuthCredentials): string {
  return credentials.access;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
  // Auto-import kimi-cli credentials: set as environment variable
  // so pi can use it immediately without /login
  let seeded = false;
  if (!process.env.KIMI_CODER_API_KEY) {
    const token = loadKimiCliToken();
    if (token && token.access_token && token.expires_at > Date.now() / 1000 + 60) {
      process.env.KIMI_CODER_API_KEY = token.access_token;
      seeded = true;
    }
  }

  // Also seed auth.json for OAuth refresh support
  seedPiAuthFromKimiCli();

  pi.registerProvider(PROVIDER_NAME, {
    baseUrl: BASE_URL,
    apiKey: "KIMI_CODER_API_KEY",
    api: "openai-completions",
    authHeader: true,

    // Required: Kimi Coding API checks User-Agent to verify it's a coding agent
    headers: {
      "User-Agent": "KimiCLI/1.5",
    },

    models: [
      {
        id: "kimi-for-coding",
        name: "Kimi for Coding (K2.5)",
        reasoning: true,
        input: ["text", "image"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 262144,
        maxTokens: 32768,
        compat: {
          thinkingFormat: "zai",
          maxTokensField: "max_tokens",
          supportsDeveloperRole: false,
          supportsStore: false,
        },
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        reasoning: true,
        input: ["text", "image"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 262144,
        maxTokens: 32768,
        compat: {
          thinkingFormat: "zai",
          maxTokensField: "max_tokens",
          supportsDeveloperRole: false,
          supportsStore: false,
        },
      },
    ],

    oauth: {
      name: "Kimi Coder (K2 Coding Plan)",
      login: loginKimiCoder,
      refreshToken: refreshKimiCoderToken,
      getApiKey,
    },
  });

  // On session start: refresh token if needed, notify user
  pi.on("session_start", async (_event, ctx) => {
    if (seeded && ctx.hasUI) {
      ctx.ui.notify("Kimi Coder: using kimi-cli credentials", "info");
    }

    // Check if token needs refresh (less than 5 min remaining)
    const token = loadKimiCliToken();
    if (token && token.refresh_token) {
      const remainingSecs = token.expires_at - Date.now() / 1000;
      if (remainingSecs < 300) {
        try {
          const refreshed = await refreshAccessToken(token.refresh_token);
          saveKimiCliToken(refreshed);
          process.env.KIMI_CODER_API_KEY = refreshed.access_token;
          if (ctx.hasUI) {
            ctx.ui.notify("Kimi Coder: token refreshed", "info");
          }
        } catch {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Kimi Coder: token refresh failed, use /login kimi-coder",
              "warning"
            );
          }
        }
      }
    }
  });

  // Periodically refresh token during long sessions (every 10 min)
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  pi.on("agent_start", async () => {
    if (refreshInterval) return;
    refreshInterval = setInterval(async () => {
      const token = loadKimiCliToken();
      if (!token || !token.refresh_token) return;
      const remainingSecs = token.expires_at - Date.now() / 1000;
      if (remainingSecs < 300) {
        try {
          const refreshed = await refreshAccessToken(token.refresh_token);
          saveKimiCliToken(refreshed);
          process.env.KIMI_CODER_API_KEY = refreshed.access_token;
        } catch {
          // Will retry next interval
        }
      }
    }, 10 * 60 * 1000);
  });

  pi.on("session_shutdown", async () => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  });
}
