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

  const fileNames = (data.files || []).map(f => escapeHtml(f.fileName)).join(", ");

  detailsBox.innerHTML = `
    <p><strong>Files:</strong> ${fileNames}</p>
    <p><strong>Name:</strong> ${escapeHtml(data.studentName)}</p>
    <p><strong>Copies:</strong> ${data.copies}</p>
    <p><strong>Print Type:</strong> ${escapeHtml(data.printType)}</p>
    <p><strong>Status:</strong> ${escapeHtml(data.status)}</p>
    <p><strong>Privacy:</strong> ${escapeHtml(data.privacyMessage)}</p>
    <p><strong>Auto-delete deadline:</strong> ${new Date(data.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
  `;

  const paymentCard = document.getElementById("paymentCard");
  const paymentActionBox = document.getElementById("paymentActionBox");

  if (data.paymentStatus !== "Paid" && data.status !== "Completed" && data.status !== "Expired") {
    paymentCard.style.display = "block";
    paymentActionBox.innerHTML = `
      <p style="margin-top: 0; margin-bottom: 8px; font-weight: 800; font-size: 1.2rem;">₹${data.totalCost}</p>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent('upi://pay?pa=' + window.SHOP_UPI_ID + '&pn=PrintShop&am=' + data.totalCost + '&cu=INR')}" alt="UPI QR Code" style="display: block; max-width: 100px; margin-bottom: 12px;"/>
      <a href="upi://pay?pa=${window.SHOP_UPI_ID}&pn=PrintShop&am=${data.totalCost}&cu=INR" class="cta-button" style="display:block; text-align:center; text-decoration:none; padding: 8px; font-size: 0.85rem; width: 100%;">Pay via UPI</a>
      <p style="margin-top: 8px; margin-bottom: 0; font-size: 0.8rem; color: var(--ink);">Or pay cash at counter</p>
    `;
  } else if (data.paymentStatus === "Paid") {
    paymentCard.style.display = "block";
    paymentActionBox.innerHTML = `
      <strong style="color: #08762b; font-size: 1.2rem; display: block; margin-top: 8px;">✓ Paid</strong>
      <p style="margin-top: 4px; margin-bottom: 0; font-size: 0.85rem;">Payment confirmed.</p>
    `;
  } else {
    paymentCard.style.display = "none";
  }

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
