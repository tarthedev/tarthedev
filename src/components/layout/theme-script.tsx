/**
 * Applies the stored theme before first paint. Without this the page flashes
 * light before hydration on a dark-mode device, which looks broken.
 */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem("kpi-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
