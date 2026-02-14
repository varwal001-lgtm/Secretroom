import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { ThreeDotMenu } from "./ThreeDotMenu";
import { TypingIndicator } from "./TypingIndicator";

export function ChatShell({
  roomName,
  pinnedMessage,
  pinnedMessageId,
  messages,
  feedRef,
  onReply,
  onPin,
  onReact,
  recentIds,
  someoneTyping,
  draft,
  onDraftChange,
  onSend,
  replyTarget,
  onClearReply,
  showEmoji,
  onToggleEmoji,
  onAppendEmoji,
  onTyping,
  onInstall,
  showInstallOption,
  onLogout,
  error,
}) {
  return (
    <section className="chat-shell">
      <header className="chat-header">
        <div>
          <p className="room-tag">Anonymous Room</p>
          <h2>{roomName || "Secret Room"}</h2>
        </div>
        <ThreeDotMenu
          onInstall={onInstall}
          showInstallOption={showInstallOption}
          onLogout={onLogout}
        />
      </header>

      {pinnedMessage ? (
        <div className="pinned-banner">
          <strong>Pinned</strong>
          <p>{pinnedMessage.content}</p>
        </div>
      ) : null}

      <MessageList
        messages={messages}
        feedRef={feedRef}
        pinnedMessageId={pinnedMessageId}
        onReply={onReply}
        onPin={onPin}
        onReact={onReact}
        recentIds={recentIds}
      />

      <TypingIndicator visible={someoneTyping} />
      {error ? <p className="error-banner">{error}</p> : null}

      <MessageComposer
        draft={draft}
        onDraftChange={onDraftChange}
        onSend={onSend}
        replyTarget={replyTarget}
        onClearReply={onClearReply}
        showEmoji={showEmoji}
        onToggleEmoji={onToggleEmoji}
        onAppendEmoji={onAppendEmoji}
        onTyping={onTyping}
      />
    </section>
  );
}
