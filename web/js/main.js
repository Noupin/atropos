document.getElementById("year").textContent = new Date().getFullYear();

const form = document.getElementById("signup");
const statusEl = document.getElementById("status");
const emailEl = document.getElementById("email");
const btn = document.getElementById("submitBtn");

function showStatus(kind, text){
  statusEl.className = "status show " + (kind || "");
  statusEl.textContent = text || "";
}
function hideStatus(){
  statusEl.className = "status";
  statusEl.textContent = "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideStatus();                 // no empty box before we have text

  const email = emailEl.value.trim();
  if (!email) return;

  btn.disabled = true;
  showStatus("", "Sending…");

  try {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email })
    });

    let data = {};
    try { data = await res.json(); } catch {}

    if (res.ok && data && data.ok) {
      if (data.duplicate) {
        showStatus("info", "You're already on the list.");
      } else {
        showStatus("success", "Welcome aboard — you're on the list!");
        form.reset();
      }
    } else if (res.status === 400 && data && data.error) {
      showStatus("error", data.error);                  // validation issue (e.g., bad email)
    } else {
      showStatus("error", "Something went wrong on our side. Please try again shortly.");
    }
  } catch {
    showStatus("error", "Network error. Check your connection and try again.");
  } finally {
    btn.disabled = false;
  }
});
