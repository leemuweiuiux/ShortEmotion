import { vi, it, expect, afterEach } from "vitest";
import { requestJson, verifyLogin } from "../public/login/request.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("bounds a stalled response body and aborts without retry", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }));
  vi.stubGlobal("fetch", fetch);
  const pending = expect(requestJson("/api/auth?action=verify", {}, 100)).rejects.toMatchObject({ code: "request_timeout" });
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("recovers a lost verification response with one cookie check", async () => {
  const verify = vi.fn().mockRejectedValue({ code: "request_timeout" });
  const check = vi.fn().mockResolvedValue({ user: { email: "friend@example.com" } });
  await verifyLogin(verify, check, "friend@example.com");
  expect(verify).toHaveBeenCalledTimes(1);
  expect(check).toHaveBeenCalledTimes(1);
});

it("stops on missing cookies instead of navigating into a login loop", async () => {
  const check = vi.fn().mockResolvedValue({ user: null });
  await expect(verifyLogin(async () => {}, check, "friend@example.com")).rejects.toMatchObject({ code: "session_missing" });
  expect(check).toHaveBeenCalledTimes(1);
});

it("never accepts another account's existing session", async () => {
  await expect(verifyLogin(async () => {}, async () => ({ user: { email: "other@example.com" } }), "friend@example.com")).rejects.toMatchObject({ code: "session_missing" });
});

it("does not retry or check sessions for a rejected OTP", async () => {
  const check = vi.fn();
  await expect(verifyLogin(async () => { throw { status: 403, code: "otp_expired" }; }, check, "friend@example.com")).rejects.toMatchObject({ code: "otp_expired" });
  expect(check).not.toHaveBeenCalled();
});

it("stops after one failed recovery check", async () => {
  const check = vi.fn().mockRejectedValue({ code: "request_timeout" });
  await expect(verifyLogin(async () => { throw new TypeError("network"); }, check, "friend@example.com")).rejects.toMatchObject({ code: "request_timeout" });
  expect(check).toHaveBeenCalledTimes(1);
});
