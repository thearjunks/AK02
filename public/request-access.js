const form = document.querySelector("#requestAccessForm");
const message = document.querySelector("#requestMessage");
const button = document.querySelector("#submitRequestBtn");

function show(text, mode) {
  message.hidden = false;
  message.className = `connectionMessage ${mode}`;
  message.textContent = text;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = "Submitting...";
  const payload = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch("/api/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Access request could not be submitted.");
    form.reset();
    show("Access request submitted successfully. An Admin can now review it.", "success");
  } catch (error) {
    show(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Submit request";
  }
});
