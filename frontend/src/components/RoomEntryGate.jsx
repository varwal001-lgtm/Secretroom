export function RoomEntryGate({ accessKey, onAccessKeyChange, onEnter, entering, error }) {
  return (
    <section className={`entry-shell ${entering ? "entering" : ""}`}>
      <div className="space-vignette" aria-hidden="true" />
      <div className="warp-flash" aria-hidden="true" />
      <div className="entry-card fade-up">
        <p className="entry-tag">Anonymous Classroom Channel</p>
        <h1>Secret Room</h1>
        <p className="entry-copy">Enter the private key to join the shared anonymous room.</p>
        <form onSubmit={onEnter} className="entry-form">
          <label htmlFor="access-key" className="entry-label">Private Key</label>
          <input
            id="access-key"
            value={accessKey}
            onChange={(event) => onAccessKeyChange(event.target.value)}
            type="password"
            placeholder="Enter private key"
            autoComplete="off"
            spellCheck="false"
            className="entry-input"
            required
          />
          {error ? <p className="entry-error">{error}</p> : null}
          <button type="submit" className="entry-button" disabled={entering}>
            {entering ? "Engaging Warp..." : "Enter Secret Room"}
          </button>
        </form>
      </div>
    </section>
  );
}
