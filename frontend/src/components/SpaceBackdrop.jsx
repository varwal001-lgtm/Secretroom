import { useEffect, useRef } from "react";

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function buildStars(count) {
  return Array.from({ length: count }, () => ({
    x: rand(-1, 1),
    y: rand(-1, 1),
    z: rand(0.08, 1),
    twinkle: rand(0.3, 1),
    drift: rand(-0.00025, 0.00025),
    temp: rand(0.72, 1),
  }));
}

function resetStar(star) {
  star.x = rand(-1, 1);
  star.y = rand(-1, 1);
  star.z = rand(0.7, 1);
  star.twinkle = rand(0.25, 1);
  star.drift = rand(-0.00025, 0.00025);
  star.temp = rand(0.72, 1);
}

export function SpaceBackdrop({ entering }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return undefined;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let stars = [];
    let streaks = [];
    let lastTs = performance.now();
    let lastStreakTs = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const memory = navigator.deviceMemory || 4;
      const area = width * height;
      const baseCount = Math.floor(area / 8000);
      const budget = memory <= 2 ? 0.6 : memory <= 4 ? 0.8 : 1;
      const count = Math.max(55, Math.min(170, Math.floor(baseCount * budget)));
      stars = buildStars(count);
      streaks = [];
    }

    function spawnStreak(now) {
      const interval = entering ? 80 : rand(1700, 3200);
      if (now - lastStreakTs < interval) return;
      lastStreakTs = now;
      streaks.push({
        x: rand(0, width),
        y: rand(0, height * 0.52),
        vx: entering ? rand(540, 860) : rand(260, 420),
        vy: entering ? rand(190, 330) : rand(120, 210),
        life: entering ? rand(0.22, 0.35) : rand(0.35, 0.55),
        age: 0,
      });
      if (streaks.length > 14) streaks.shift();
    }

    function draw(now) {
      const dt = Math.min(32, now - lastTs);
      lastTs = now;

      context.fillStyle = entering ? "rgba(2,7,16,0.34)" : "rgba(2,7,16,0.72)";
      context.fillRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.5;
      const base = Math.max(width, height) * 0.72;
      const speed = entering ? 0.021 : 0.0019;

      for (const star of stars) {
        star.z -= speed * dt;
        star.x += star.drift * dt;

        if (star.z <= 0.015 || Math.abs(star.x) > 1.45 || Math.abs(star.y) > 1.45) {
          resetStar(star);
        }

        const inv = 1 / star.z;
        const px = cx + star.x * inv * base;
        const py = cy + star.y * inv * base;

        if (px < -20 || py < -20 || px > width + 20 || py > height + 20) {
          resetStar(star);
          continue;
        }

        const radius = entering ? Math.min(2.8, 0.7 + inv * 0.12) : Math.min(2.2, 0.4 + inv * 0.06);
        const alpha = Math.max(0.14, Math.min(1, star.twinkle * (0.3 + inv * 0.06)));
        const white = Math.floor(220 + star.temp * 35);

        if (entering) {
          const tail = Math.min(22, inv * 0.8);
          context.strokeStyle = `rgba(${white},${white},${white},${alpha * 0.65})`;
          context.lineWidth = Math.max(1, radius * 0.75);
          context.beginPath();
          context.moveTo(px - star.x * tail, py - star.y * tail);
          context.lineTo(px, py);
          context.stroke();
        }

        context.fillStyle = `rgba(${white},${white},${white},${alpha})`;
        context.beginPath();
        context.arc(px, py, radius, 0, Math.PI * 2);
        context.fill();
      }

      spawnStreak(now);

      for (let i = streaks.length - 1; i >= 0; i -= 1) {
        const streak = streaks[i];
        streak.age += dt / 1000;
        streak.x += streak.vx * (dt / 1000);
        streak.y += streak.vy * (dt / 1000);

        if (streak.age > streak.life || streak.x > width + 140 || streak.y > height + 120) {
          streaks.splice(i, 1);
          continue;
        }

        const lifeRatio = 1 - streak.age / streak.life;
        context.strokeStyle = `rgba(240,245,255,${0.16 + lifeRatio * 0.6})`;
        context.lineWidth = entering ? 2.2 : 1.6;
        context.beginPath();
        context.moveTo(streak.x, streak.y);
        context.lineTo(streak.x - (entering ? 160 : 90), streak.y - (entering ? 72 : 40));
        context.stroke();
      }

      if (entering) {
        const pulse = 0.16 + Math.sin(now * 0.012) * 0.05;
        const glow = context.createRadialGradient(cx, cy, 4, cx, cy, Math.max(width, height) * 0.52);
        glow.addColorStop(0, `rgba(245,247,255,${pulse})`);
        glow.addColorStop(1, "rgba(245,247,255,0)");
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      }

      raf = requestAnimationFrame(draw);
    }

    function drawStatic() {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(2,7,16,0.84)";
      context.fillRect(0, 0, width, height);
      const cx = width * 0.5;
      const cy = height * 0.5;
      const base = Math.max(width, height) * 0.72;

      for (const star of stars) {
        const inv = 1 / star.z;
        const px = cx + star.x * inv * base;
        const py = cy + star.y * inv * base;
        const white = Math.floor(220 + star.temp * 35);
        context.fillStyle = `rgba(${white},${white},${white},${0.2 + star.twinkle * 0.5})`;
        context.beginPath();
        context.arc(px, py, 1, 0, Math.PI * 2);
        context.fill();
      }
    }

    resize();

    if (reducedMotion) {
      drawStatic();
    } else {
      raf = requestAnimationFrame(draw);
    }

    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [entering]);

  return <canvas ref={canvasRef} className="space-canvas" aria-hidden="true" />;
}
