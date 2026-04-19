const API_BASE_URL = "https://smart-print-queue-system.onrender.com";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function apiFetch(path, options = {}, retriesLeft = 1) {
  const url = `${API_BASE_URL}${path}`;

  try {
    const response = await fetch(url, options);

    if (response.status >= 500 && retriesLeft > 0) {
      await delay(2000);
      return apiFetch(path, options, retriesLeft - 1);
    }

    return response;
  } catch (error) {
    if (retriesLeft > 0) {
      await delay(2000);
      return apiFetch(path, options, retriesLeft - 1);
    }

    throw error;
  }
}
