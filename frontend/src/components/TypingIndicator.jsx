export function TypingIndicator({ visible }) {
  return (
    <div className={`typing-indicator ${visible ? "show" : ""}`} aria-live="polite">
      <span className="typing-pill">
        <i />
        <i />
        <i />
      </span>
      <span className="typing-text">typing...</span>
    </div>
  );
}
