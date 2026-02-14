import { useRef, useState } from "react";

const ACTIVATION_PX = 64;
const MAX_OFFSET_PX = 88;

export function useSwipeReply(onReply) {
  const startRef = useRef({ x: 0, y: 0, active: false, touchId: null });
  const [offsetX, setOffsetX] = useState(0);

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startRef.current = {
      x: event.clientX,
      y: event.clientY,
      active: true,
      touchId: event.pointerId,
    };
  }

  function onPointerMove(event) {
    const state = startRef.current;
    if (!state.active || state.touchId !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.abs(dy) > Math.abs(dx)) return;
    const next = Math.max(0, Math.min(MAX_OFFSET_PX, dx));
    setOffsetX(next);
  }

  function finishGesture() {
    const shouldReply = offsetX >= ACTIVATION_PX;
    startRef.current.active = false;
    setOffsetX(0);
    if (shouldReply) {
      onReply();
    }
  }

  function onPointerUp(event) {
    if (startRef.current.touchId !== event.pointerId) return;
    finishGesture();
  }

  function onPointerCancel(event) {
    if (startRef.current.touchId !== event.pointerId) return;
    startRef.current.active = false;
    setOffsetX(0);
  }

  return {
    offsetX,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
