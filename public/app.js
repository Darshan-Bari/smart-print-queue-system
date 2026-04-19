const uploadForm = document.getElementById("uploadForm");
const formMessage = document.getElementById("formMessage");
const submitButton = document.getElementById("submitButton");

function setFormMessage(message, type = "") {
  formMessage.textContent = message;
  formMessage.className = "form-message";

  if (type) {
    formMessage.classList.add(type === "error" ? "is-error" : "is-success");
  }
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormMessage("");
  submitButton.disabled = true;
  submitButton.textContent = "Generating...";

  try {
    const formData = new FormData(uploadForm);

    const response = await apiFetch("/api/requests", {
      method: "POST",
      body: formData
    });

    const contentType = response.headers.get("content-type");

    let data = {};

    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error("Server returned non-JSON:", text);
      throw new Error("Server error. Please try again.");
    }

    if (!response.ok) {
      throw new Error(data.message || "Unable to create print request.");
    }

    if (!data.tokenNumber) {
      throw new Error("Invalid response from server.");
    }

    window.location.href = `/status.html?token=${encodeURIComponent(data.tokenNumber)}&created=1`;

  } catch (error) {
    setFormMessage(error.message || "Network error. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Generate Token";
  }
});