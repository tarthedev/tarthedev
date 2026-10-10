import { useEffect } from "react";

/** Sets the browser tab (and app switcher) title: "Customers · DWRG". */
export function useTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · DWRG` : "DWRG";
  }, [title]);
}
