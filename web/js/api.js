(() => {
  const RETRYABLE_STATUSES = new Set([502, 503, 504]);
  const REQUEST_TIMEOUT_MS = 8000;

  const normalizeBase = (value) => {
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.replace(/\/$/, "");
  };

  const resolveBase = () => {
    if (typeof window === "undefined") {
      return "/api";
    }

    const overrideBase = normalizeBase(window.ATROPOS_API_BASE);
    if (overrideBase) {
      return overrideBase;
    }

    const host = window.location?.hostname || "";
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://127.0.0.1:5001";
    }

    return "/api";
  };

  const buildUrl = (base, path, searchParams) => {
    const normalizedBase = normalizeBase(base) || "/api";
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = normalizedBase.startsWith("http")
      ? new URL(`${normalizedBase}${normalizedPath}`)
      : new URL(`${normalizedBase}${normalizedPath}`, window.location.origin);

    if (searchParams) {
      const params =
        searchParams instanceof URLSearchParams
          ? searchParams
          : new URLSearchParams(searchParams);
      params.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
    }

    const logPath = `${normalizedPath}${url.search ? url.search : ""}`;
    return { href: url.toString(), logPath };
  };

  const fetchWithTimeout = async (href, logPath, base, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;

    try {
      response = await fetch(href, {
        mode: "same-origin",
        credentials: "same-origin",
        ...options,
        signal: controller.signal,
      });
      console.log(`api ${logPath} base=${base} status=${response.status}`);
      return response;
    } catch (error) {
      if (!response) {
        console.log(`api ${logPath} base=${base} status=error`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const request = async (path, options = {}) => {
    const { method = "GET", headers = {}, body, searchParams, parse = "json" } =
      options;
    const base = resolveBase();
    const { href, logPath } = buildUrl(base, path, searchParams);

    const attempts = 2;
    let lastError = null;
    let response = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        response = await fetchWithTimeout(href, logPath, base, {
          method,
          headers,
          body,
        });
      } catch (error) {
        lastError = error;
        if (attempt === attempts - 1) {
          throw error;
        }
        continue;
      }

      if (
        RETRYABLE_STATUSES.has(response.status) &&
        attempt < attempts - 1
      ) {
        lastError = new Error(`Retrying due to ${response.status}`);
        continue;
      }

      break;
    }

    if (!response) {
      throw lastError || new Error("No response received");
    }

    let data = null;
    if (parse === "json") {
      try {
        data = await response.json();
      } catch (error) {
        console.warn(`api ${path} failed to parse JSON`, error);
      }
    }

    return { base, url: href, response, data };
  };

  window.AtroposApi = {
    resolveBase,
    request,
  };
})();
