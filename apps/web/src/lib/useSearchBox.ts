import { useEffect, useRef, useState } from "react";
import { useDebounced } from "./useDebounced";

/**
 * A search box whose text lives in the URL (so Back and reload keep it).
 * Typing commits a beat after the last key; Back/forward puts the URL's text
 * back in the box without fighting someone still typing.
 */
export function useSearchBox(
  urlValue: string | undefined,
  commit: (value: string | undefined) => void,
  delayMs = 300,
) {
  const [text, setText] = useState(urlValue ?? "");
  const settled = useDebounced(text.trim(), delayMs);
  const sent = useRef(urlValue ?? "");
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (settled === sent.current) return;
    sent.current = settled;
    commitRef.current(settled || undefined);
  }, [settled]);

  useEffect(() => {
    const value = urlValue ?? "";
    if (value === sent.current) return;
    sent.current = value;
    setText(value);
  }, [urlValue]);

  /** Commit now (the keyboard's Search key). */
  const submitNow = () => {
    const value = text.trim();
    sent.current = value;
    commitRef.current(value || undefined);
  };

  return { text, setText, submitNow };
}
