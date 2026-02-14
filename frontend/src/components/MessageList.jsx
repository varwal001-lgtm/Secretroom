import { useMemo } from "react";
import { useSwipeReply } from "../hooks/useSwipeReply";

const QUICK_REACTIONS = ["\u{1F44D}", "\u{1F525}", "\u{1F602}", "\u{2764}\u{FE0F}"];

function MessageCard({ message, isPinned, onReply, onPin, onReact, highlighted }) {
  const { offsetX, bind } = useSwipeReply(() => onReply(message));
  const reactionList = useMemo(
    () => Object.entries(message.reactions || {}).filter(([, users]) => users.length > 0),
    [message.reactions]
  );

  return (
    <article className={`message-card ${highlighted ? "fresh" : ""}`} style={{ transform: `translate3d(${offsetX}px,0,0)` }} {...bind}>
      <header>
        <div>
          <strong>{message.anonName}</strong>
          <span>{new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div className="message-actions">
          <button type="button" onClick={() => onPin(message.id)} className={isPinned ? "active" : ""}>Pin</button>
        </div>
      </header>
      {message.replyTo ? (
        <div className="reply-bubble">
          <strong>{message.replyTo.anonName}</strong>
          <p>{message.replyTo.contentPreview}</p>
        </div>
      ) : null}
      <p>{message.content}</p>
      <div className="reaction-row">
        {reactionList.map(([emoji, users]) => (
          <button key={emoji} type="button" className="reaction-chip pop" onClick={() => onReact(message.id, emoji)}>
            {emoji} {users.length}
          </button>
        ))}
        {QUICK_REACTIONS.map((emoji) => (
          <button key={`${message.id}-${emoji}`} type="button" className="reaction-add" onClick={() => onReact(message.id, emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    </article>
  );
}

export function MessageList({ messages, feedRef, pinnedMessageId, onReply, onPin, onReact, recentIds }) {
  return (
    <section ref={feedRef} className="messages-feed">
      {messages.length === 0 ? <p className="empty-state">No messages yet. Start the room.</p> : null}
      {messages.map((message) => (
        <MessageCard
          key={message.id}
          message={message}
          isPinned={pinnedMessageId === message.id}
          onReply={onReply}
          onPin={onPin}
          onReact={onReact}
          highlighted={recentIds.has(message.id)}
        />
      ))}
    </section>
  );
}
