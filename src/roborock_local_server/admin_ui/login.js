"use strict";

const form = document.getElementById("loginForm");
const button = document.getElementById("login");
const result = document.getElementById("result");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Signing in…";
  result.hidden = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/admin/api/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({password: document.getElementById("password").value}),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Sign-in failed. Please try again.");
    window.location.reload();
  } catch (error) {
    result.textContent = error.name === "AbortError"
      ? "The server took too long to respond. Please try again."
      : error.message || "Unable to reach the server. Please try again.";
    result.className = "message error";
    result.hidden = false;
    button.disabled = false;
    button.textContent = "Sign in";
  } finally {
    clearTimeout(timer);
  }
});
