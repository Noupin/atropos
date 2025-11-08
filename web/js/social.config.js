(() => {
  if (typeof window === "undefined") {
    return;
  }
  const existing = window.atroposSocialConfig;
  if (existing && typeof existing === "object") {
    window.atroposSocialConfig = existing;
    return;
  }
  window.atroposSocialConfig = {};
})();
