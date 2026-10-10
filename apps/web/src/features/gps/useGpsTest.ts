import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendLog,
  describeFix,
  describeGeoError,
  type FixLike,
  type LogEntry,
  type LogKind,
} from "./gpsLog";

/**
 * The month-1 iPad GPS test (docs/03-tech-stack.md, Truck GPS): a tap starts
 * watchPosition with high accuracy and asks for a Screen Wake Lock; the page
 * logs fixes, visibility changes, the permission state and wake-lock events,
 * and restarts the watch when it becomes visible again. The log is kept on
 * this device only (localStorage) so it survives a cold launch; nothing is
 * sent anywhere.
 */

export interface Fix extends FixLike {
  altitude: number | null;
  /** When the device took the fix (epoch ms). */
  takenAt: number;
  /** When the page received it (epoch ms). */
  receivedAt: number;
}

export type PermissionLabel = "granted" | "prompt" | "denied" | "unknown";
export type WakeLockLabel = "on" | "off" | "unsupported" | "failed";

const STORAGE_KEY = "dwrg.gpsTest.log";
const SAVE_EVERY_MS = 3000;
/** Fix times kept for the per-minute counts (about 4 hours at one a second). */
const MAX_FIX_TIMES = 15_000;

function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (e): e is LogEntry =>
            typeof e === "object" &&
            e !== null &&
            typeof e.at === "number" &&
            typeof e.kind === "string" &&
            typeof e.message === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function saveLog(log: readonly LogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage full or blocked (private browsing): the on-screen log still works.
  }
}

export function isStandalone(): boolean {
  const media =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return media || ios;
}

/** Logged once per page load (React's dev double-mount would log it twice). */
let openedLogged = false;

export function useGpsTest() {
  const [log, setLog] = useState<LogEntry[]>(loadLog);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [fixTimes, setFixTimes] = useState<number[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionLabel>("unknown");
  const [wakeLock, setWakeLock] = useState<WakeLockLabel>(() =>
    "wakeLock" in navigator ? "off" : "unsupported",
  );
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const [needsTap, setNeedsTap] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [standalone] = useState(isStandalone);

  const watchId = useRef<number | null>(null);
  const sentinel = useRef<WakeLockSentinel | null>(null);
  const runningRef = useRef(false);
  const logRef = useRef(log);
  logRef.current = log;

  const add = useCallback((kind: LogKind, message: string) => {
    setLog((current) => appendLog(current, { at: Date.now(), kind, message }));
  }, []);

  // Save the log a few seconds after it changes, and at once when the page hides.
  useEffect(() => {
    const timer = setTimeout(() => saveLog(log), SAVE_EVERY_MS);
    return () => clearTimeout(timer);
  }, [log]);

  const onFix = useCallback(
    (position: GeolocationPosition) => {
      const c = position.coords;
      const next: Fix = {
        latitude: c.latitude,
        longitude: c.longitude,
        accuracy: c.accuracy,
        altitude: c.altitude,
        speed: c.speed,
        heading: c.heading,
        takenAt: position.timestamp,
        receivedAt: Date.now(),
      };
      setFix(next);
      // Move the page clock up to this fix, so the counts include it at once
      // instead of on the next one-second tick.
      setNow((current) => Math.max(current, next.receivedAt));
      setLastError(null);
      setFixTimes((times) => {
        const all = [...times, next.receivedAt];
        return all.length > MAX_FIX_TIMES ? all.slice(all.length - MAX_FIX_TIMES) : all;
      });
      add("fix", describeFix(next));
    },
    [add],
  );

  const onError = useCallback(
    (error: GeolocationPositionError) => {
      const message = describeGeoError(error.code, error.message);
      setLastError(message);
      if (error.code === 1) setPermission("denied");
      add("error", message);
    },
    [add],
  );

  const beginWatch = useCallback((): boolean => {
    if (!("geolocation" in navigator)) {
      add("error", "This browser has no location service.");
      setLastError("This browser has no location service.");
      return false;
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30_000,
    });
    return true;
  }, [add, onFix, onError]);

  const endWatch = useCallback(() => {
    if (watchId.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
  }, []);

  const requestWakeLock = useCallback(async () => {
    const api = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    if (!api) {
      setWakeLock("unsupported");
      add(
        "wake-lock",
        "Screen Wake Lock isn't available here; set Auto-Lock to Never while testing.",
      );
      return;
    }
    if (sentinel.current && !sentinel.current.released) return;
    try {
      const lock = await api.request("screen");
      sentinel.current = lock;
      setWakeLock("on");
      setNeedsTap(false);
      add("wake-lock", "Screen will stay on");
      lock.addEventListener("release", () => {
        if (sentinel.current === lock) sentinel.current = null;
        setWakeLock("off");
        add("wake-lock", "Released: the screen can lock now");
      });
    } catch (error) {
      setWakeLock("failed");
      add(
        "wake-lock",
        `Couldn't keep the screen on: ${error instanceof Error ? error.message : String(error)}`,
      );
      // iPadOS wants a tap before it grants the lock again.
      if (runningRef.current) setNeedsTap(true);
    }
  }, [add]);

  const releaseWakeLock = useCallback(() => {
    const lock = sentinel.current;
    sentinel.current = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
  }, []);

  /** Start (must run from a tap: iPadOS asks for location and the wake lock only then). */
  const start = useCallback(() => {
    runningRef.current = true;
    const at = Date.now();
    setRunning(true);
    setStartedAt(at);
    setNow(at);
    setFix(null);
    setFixTimes([]);
    setLastError(null);
    add("start", "Start tapped: watching position (high accuracy)");
    beginWatch();
    void requestWakeLock();
  }, [add, beginWatch, requestWakeLock]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setNeedsTap(false);
    endWatch();
    releaseWakeLock();
    add("stop", "Stopped");
  }, [add, endWatch, releaseWakeLock]);

  /** The "Tap to resume GPS" banner. */
  const resume = useCallback(() => {
    add("start", "Resumed by a tap");
    beginWatch();
    void requestWakeLock();
  }, [add, beginWatch, requestWakeLock]);

  const clearLog = useCallback(() => {
    setLog([]);
    saveLog([]);
  }, []);

  // Page lifecycle: visibility, page show/hide, connection.
  useEffect(() => {
    if (!openedLogged) {
      openedLogged = true;
      add(
        "app",
        `Page opened: ${standalone ? "home-screen app" : "in the browser"}, ${
          document.visibilityState
        }`,
      );
    }
    const onVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      if (!isVisible) {
        add("visibility", "Page hidden: iPadOS stops location while hidden");
        saveLog(logRef.current);
        return;
      }
      add("visibility", "Page visible");
      if (runningRef.current) {
        beginWatch();
        add("start", "Watch restarted after the page came back");
        void requestWakeLock();
      }
    };
    const onPageHide = (e: PageTransitionEvent) => {
      add("page", e.persisted ? "Page hidden (kept in memory)" : "Page closing");
      saveLog(logRef.current);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) add("page", "Page shown again from memory");
    };
    const onOnline = () => add("network", "Connection back");
    const onOffline = () => add("network", "Connection lost");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [add, beginWatch, requestWakeLock, standalone]);

  // Permission state, where the browser can tell (Safari 16+).
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (!status) return;
      setPermission(status.state);
      add("permission", `Location permission is now "${status.state}"`);
    };
    if (!navigator.permissions?.query) {
      add("permission", "This browser can't report the location permission");
      return;
    }
    navigator.permissions
      .query({ name: "geolocation" })
      .then((result) => {
        if (cancelled) return;
        status = result;
        setPermission(result.state);
        add("permission", `Location permission: "${result.state}"`);
        result.addEventListener("change", onChange);
      })
      .catch(() => {
        if (!cancelled) add("permission", "This browser can't report the location permission");
      });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
    };
  }, [add]);

  // A clock for "time since the last fix".
  useEffect(() => {
    if (!running && !fix) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, fix]);

  // Leaving the page stops everything.
  useEffect(
    () => () => {
      endWatch();
      releaseWakeLock();
    },
    [endWatch, releaseWakeLock],
  );

  return {
    log,
    running,
    startedAt,
    fix,
    fixTimes,
    lastError,
    permission,
    wakeLock,
    visible,
    needsTap,
    now,
    standalone,
    start,
    stop,
    resume,
    clearLog,
  };
}
