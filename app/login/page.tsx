"use client";

import { useState } from "react";
import Wordmark from "@/components/Wordmark";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error || "Wrong username or password.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="login">
      <form className="card" onSubmit={onSubmit}>
        <Wordmark level="p" />
        <h1>Sign in</h1>
        <label>
          Username
          <input className="field" name="username" autoComplete="username" required />
        </label>
        <label>
          Password
          <input className="field" name="password" type="password" autoComplete="current-password" required />
        </label>
        {error ? <p className="err">{error}</p> : null}
        <button className="primary" type="submit" disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
      </form>
    </main>
  );
}
