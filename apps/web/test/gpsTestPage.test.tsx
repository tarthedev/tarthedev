import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GpsTestPage } from "../src/features/gps/GpsTestPage";

/**
 * The GPS test page against a fake iPad: geolocation, Screen Wake Lock and
 * the Permissions API are stubbed so the test can hand it fixes and errors
 * and hide or show the page.
 */

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

interface FakeIpad {
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
  requestWakeLock: ReturnType<typeof vi.fn>;
  writeText: ReturnType<typeof vi.fn>;
  fix: (lat: number, lng: number, accuracy: number) => void;
  fail: (code: number, message: string) => void;
  setVisibility: (state: "visible" | "hidden") => void;
}

function installFakeIpad(): FakeIpad {
  let onFix: Success | undefined;
  let onError: Failure | undefined;
  const watchPosition = vi.fn((success: Success, failure: Failure) => {
    onFix = success;
    onError = failure;
    return watchPosition.mock.calls.length;
  });
  const clearWatch = vi.fn();
  const requestWakeLock = vi.fn(async () => {
    const lock = new EventTarget() as WakeLockSentinel;
    Object.assign(lock, { released: false, type: "screen", release: async () => {} });
    return lock;
  });
  const writeText = vi.fn(async () => {});
  const permissionStatus = Object.assign(new EventTarget(), {
    state: "prompt",
    name: "geolocation",
  });

  const define = (name: string, value: unknown) =>
    Object.defineProperty(navigator, name, { value, configurable: true });
  define("geolocation", { watchPosition, clearWatch, getCurrentPosition: vi.fn() });
  define("wakeLock", { request: requestWakeLock });
  define("permissions", { query: vi.fn(async () => permissionStatus) });
  define("clipboard", { writeText });

  let visibility: "visible" | "hidden" = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });

  return {
    watchPosition,
    clearWatch,
    requestWakeLock,
    writeText,
    fix: (latitude, longitude, accuracy) =>
      act(() => {
        onFix?.({
          coords: {
            latitude,
            longitude,
            accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition);
      }),
    fail: (code, message) =>
      act(() => {
        onError?.({ code, message } as GeolocationPositionError);
      }),
    setVisibility: (state) =>
      act(() => {
        visibility = state;
        document.dispatchEvent(new Event("visibilitychange"));
      }),
  };
}

/** The on-screen log (newest first). */
const logText = () => document.querySelector("pre")?.textContent ?? "";

describe("GPS test page", () => {
  let ipad: FakeIpad;

  beforeEach(() => {
    ipad = installFakeIpad();
  });

  afterEach(() => {
    for (const name of ["geolocation", "wakeLock", "permissions", "clipboard"]) {
      Reflect.deleteProperty(navigator, name);
    }
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("does nothing until Start is tapped (iPadOS needs a tap for location and wake lock)", async () => {
    render(<GpsTestPage />);
    expect(await screen.findByText("Will ask")).toBeTruthy();
    expect(screen.getByText("No, in Safari")).toBeTruthy();
    expect(ipad.watchPosition).not.toHaveBeenCalled();
    expect(ipad.requestWakeLock).not.toHaveBeenCalled();
    expect(screen.getByText("Tap Start to begin.")).toBeTruthy();
  });

  it("Start watches position with high accuracy and keeps the screen on", async () => {
    render(<GpsTestPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(ipad.watchPosition).toHaveBeenCalledOnce();
    expect(ipad.watchPosition.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: true });
    expect(ipad.requestWakeLock).toHaveBeenCalledWith("screen");
    await waitFor(() => expect(screen.getByText("On")).toBeTruthy());
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Waiting for the first fix…")).toBeTruthy();

    ipad.fix(35.612_345, -77.366_789, 6.4);
    expect(screen.getByText("35.612345")).toBeTruthy();
    expect(screen.getByText("-77.366789")).toBeTruthy();
    expect(screen.getByText("±6 m")).toBeTruthy();
    expect(screen.getByText(/^Last fix 0 s ago$/)).toBeTruthy();
    expect(screen.getByText(/Last 60 seconds:/).textContent).toContain("Last 60 seconds: 1");
    expect(logText()).toContain("35.612345, -77.366789, ±6 m");
  });

  it("logs the page hiding and restarts the watch when it comes back", () => {
    render(<GpsTestPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    ipad.setVisibility("hidden");
    expect(logText()).toContain("Page hidden: iPadOS stops location while hidden");
    expect(screen.getByText(/Visible: no/)).toBeTruthy();
    ipad.setVisibility("visible");
    expect(logText()).toContain("Watch restarted after the page came back");
    expect(ipad.watchPosition).toHaveBeenCalledTimes(2);
    expect(ipad.clearWatch).toHaveBeenCalledWith(1);
  });

  it("says how to turn location on when it's denied", async () => {
    render(<GpsTestPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    ipad.fail(1, "User denied Geolocation");
    expect(screen.getByText("Location is turned off for this app")).toBeTruthy();
    expect(screen.getByText("Denied")).toBeTruthy();
  });

  it("shows a big Tap to resume banner when iPadOS refuses the wake lock without a tap", async () => {
    ipad.requestWakeLock.mockRejectedValue(new DOMException("Not allowed", "NotAllowedError"));
    render(<GpsTestPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const banner = await screen.findByRole("button", { name: "Tap to resume GPS" });
    expect(screen.getByText("Refused")).toBeTruthy();
    ipad.requestWakeLock.mockResolvedValueOnce(
      Object.assign(new EventTarget(), {
        released: false,
        type: "screen",
        release: async () => {},
      }),
    );
    fireEvent.click(banner);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Tap to resume GPS" })).toBeNull(),
    );
  });

  it("copies the log with a header about the device, and Stop ends the watch", async () => {
    render(<GpsTestPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    ipad.fix(35.1, -77.1, 5);
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    expect(await screen.findByText(/^Copied\./)).toBeTruthy();
    const copied = String(ipad.writeText.mock.calls[0]?.[0]);
    expect(copied).toMatch(/^DWRG GPS test log\n/);
    expect(copied).toContain("Home-screen app: no");
    expect(copied).toContain("35.100000, -77.100000, ±5 m");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(ipad.clearWatch).toHaveBeenCalled();
    expect(screen.getByText("Stopped")).toBeTruthy();
  });

  it("keeps the log on this device across a reload", async () => {
    const first = render(<GpsTestPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    ipad.setVisibility("hidden"); // Saves at once.
    first.unmount();
    render(<GpsTestPage />);
    expect(logText()).toContain("Start tapped: watching position (high accuracy)");
  });
});
