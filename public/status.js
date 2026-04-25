const lookupForm = document.getElementById("lookupForm");
const tokenInput = document.getElementById("tokenInput");
const tokenBoard = document.getElementById("tokenBoard");
const queuePositionValue = document.getElementById("queuePositionValue");
const waitTimeValue = document.getElementById("waitTimeValue");
const statusValue = document.getElementById("statusValue");
const detailsBox = document.getElementById("detailsBox");
const statusMessage = document.getElementById("statusMessage");
const confirmationBanner = document.getElementById("confirmationBanner");

const params = new URLSearchParams(window.location.search);
const created = params.get("created") === "1";
let activeToken = params.get("token") || "";
let refreshTimer = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function setStatusMessage(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = "form-message";

  if (type) {
    statusMessage.classList.add(type === "error" ? "is-error" : "is-success");
  }
}

function getStatusClass(status) {
  return `status-pill status-${String(status).toLowerCase()}`;
}

function formatWait(minutes) {
  if (minutes <= 0) {
    return "Ready now";
  }

  return `${minutes} min`;
}

function renderRequest(data) {
  tokenBoard.querySelector(".board-value").textContent = data.tokenNumber;
  queuePositionValue.textContent = data.queuePosition === 0 ? "Now" : `#${data.queuePosition}`;
  waitTimeValue.textContent = formatWait(data.estimatedWaitTimeMinutes);
  statusValue.textContent = data.status;
  statusValue.className = getStatusClass(data.status);

  detailsBox.innerHTML = `
    <p><strong>File:</strong> ${escapeHtml(data.fileName)}</p>
    <p><strong>Name:</strong> ${escapeHtml(data.studentName)}</p>
    <p><strong>Copies:</strong> ${data.copies}</p>
    <p><strong>Print Type:</strong> ${escapeHtml(data.printType)}</p>
    <p><strong>Status:</strong> ${escapeHtml(data.status)}</p>
    <p><strong>Privacy:</strong> ${escapeHtml(data.privacyMessage)}</p>
    <p><strong>Auto-delete deadline:</strong> ${new Date(data.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
  `;

  setStatusMessage(
    data.status === "Ready"
      ? "Your print is ready for pickup."
      : data.status === "Completed"
        ? "This print job has been completed and the file has been deleted."
        : data.status === "Expired"
          ? "This token expired after 30 minutes and the file was removed for privacy."
          : "Status updates refresh automatically every 5 seconds.",
    data.status === "Expired" ? "error" : "success"
  );
}

async function loadToken(tokenNumber) {
  if (!tokenNumber) {
    setStatusMessage("Enter a token number to load the request.", "error");
    return;
  }

  try {
    const response = await apiFetch(`/api/requests/${encodeURIComponent(tokenNumber)}`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "Token lookup failed.");
    }

    activeToken = data.tokenNumber;
    tokenInput.value = activeToken;
    renderRequest(data);
    startRefreshLoop();
  } catch (error) {
    setStatusMessage(error.message || "NetworkError when attempting to fetch resource", "error");
  }
}

function startRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    if (activeToken) {
      loadToken(activeToken);
    }
  }, 5000);
}

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const tokenNumber = tokenInput.value.trim().toUpperCase();
  await loadToken(tokenNumber);
});

if (created) {
  confirmationBanner.classList.remove("hidden");
}

if (activeToken) {
  tokenInput.value = activeToken;
  loadToken(activeToken);
}
