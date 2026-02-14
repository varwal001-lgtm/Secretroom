import { useEffect, useRef } from "react";
import "emoji-picker-element";

export function MessageComposer({
  draft,
  onDraftChange,
  onSend,
  replyTarget,
  onClearReply,
  showEmoji,
  onToggleEmoji,
  onAppendEmoji,
  onTyping,
}) {
  const pickerRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!showEmoji) return;
    const picker = pickerRef.current;
    if (!picker) return;
    const handleEmojiClick = (event) => {
      const emoji = event?.detail?.unicode;
      if (!emoji) return;
      onAppendEmoji(emoji);
    };
    picker.addEventListener("emoji-click", handleEmojiClick);
    return () => picker.removeEventListener("emoji-click", handleEmojiClick);
  }, [showEmoji, onAppendEmoji]);

  useEffect(() => {
    if (!showEmoji) return;
    const close = (event) => {
      if (pickerRef.current?.contains(event.target)) return;
      if (buttonRef.current?.contains(event.target)) return;
      onToggleEmoji(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showEmoji, onToggleEmoji]);

  return (
    <footer className="composer-shell">
      {replyTarget ? (
        <div className="reply-preview">
          <div>
            <strong>Replying to {replyTarget.anonName}</strong>
            <p>{replyTarget.contentPreview}</p>
          </div>
          <button type="button" onClick={onClearReply} aria-label="Clear reply">x</button>
        </div>
      ) : null}
      <div className="composer-row">
        {showEmoji ? (
          <div className="emoji-panel">
            <emoji-picker ref={pickerRef} emoji-set="google" theme="dark" />
          </div>
        ) : null}
        <button
          ref={buttonRef}
          type="button"
          className="icon-button"
          onClick={() => onToggleEmoji(!showEmoji)}
          aria-label="Toggle emoji picker"
        >
          :)
        </button>
        <input
          value={draft}
          onChange={(event) => {
            onDraftChange(event.target.value);
            onTyping(event.target.value.length > 0);
          }}
          onBlur={() => onTyping(false)}
          placeholder="Type a message"
          className="composer-input"
        />
        <button type="button" onClick={onSend} className="send-button" disabled={!draft.trim()}>
          Send
        </button>
      </div>
    </footer>
  );
}
