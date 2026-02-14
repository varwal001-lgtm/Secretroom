import { useEffect, useRef, useState } from "react";

export function ThreeDotMenu({ onInstall, showInstallOption, onLogout }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function run(action) {
    setOpen(false);
    action();
  }

  return (
    <div className="menu-root" ref={rootRef}>
      <button className="icon-button" onClick={() => setOpen((value) => !value)} aria-label="Open menu">
        <span className="kebab">...</span>
      </button>
      {open ? (
        <div className="menu-panel">
          {showInstallOption ? <button onClick={() => run(onInstall)}>Install app</button> : null}
          <button onClick={() => run(onLogout)} className="danger">Logout</button>
        </div>
      ) : null}
    </div>
  );
}
