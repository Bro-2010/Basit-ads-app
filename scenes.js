/* Basit Ads – original sample scenes. Drawn in code, so they are royalty-free by construction. */
(function () {
  'use strict';

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function label(c, str, x, y, px, color = '#fff', weight = 800) {
    c.fillStyle = color;
    c.font = `${weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(str, x, y);
  }

  function drawEcomScene(c, W, H, t) {
    const u = Math.min(W, H) / 100;
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#ff7a18');
    g.addColorStop(1, '#af002d');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    c.globalAlpha = clamp(t / 0.8);
    label(c, 'NEW ARRIVAL', W / 2, H * 0.13, u * 6, '#fff', 900);
    c.globalAlpha = 1;

    c.save();
    c.translate(W / 2, H * 0.45);
    c.rotate(Math.sin(t * 1.6) * 0.25);
    const s = u * 34;
    c.shadowColor = 'rgba(0,0,0,.35)';
    c.shadowBlur = u * 4;
    c.shadowOffsetY = u * 2;
    c.fillStyle = '#fff';
    rr(c, -s / 2, -s / 2, s, s, u * 4);
    c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = '#ffd166';
    rr(c, -s * 0.32, -s * 0.32, s * 0.64, s * 0.64, u * 3);
    c.fill();
    c.restore();

    const p = clamp((t - 1.5) / 0.5);
    const k = p < 1 ? 1 + Math.sin(p * Math.PI) * 0.25 : 1;
    c.save();
    c.translate(W * 0.74, H * 0.62);
    c.scale(k, k);
    c.globalAlpha = p;
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(0, 0, u * 11, 0, Math.PI * 2);
    c.fill();
    label(c, '$19', 0, 0, u * 6, '#af002d', 900);
    c.restore();
    c.globalAlpha = 1;

    c.globalAlpha = clamp((t - 3) / 0.6);
    label(c, 'Premium quality. Delivered to your door.', W / 2, H * 0.72, u * 3.6, '#fff', 600);
    c.globalAlpha = 1;

    const b = clamp((t - 5) / 0.6);
    if (b > 0) {
      c.globalAlpha = b;
      c.fillStyle = '#fff';
      rr(c, W / 2 - u * 27, H * 0.8, u * 54, u * 11, u * 5.5);
      c.fill();
      label(c, 'SHOP NOW →', W / 2, H * 0.8 + u * 5.5, u * 4.2, '#af002d', 900);
      c.globalAlpha = 1;
    }
  }

  function drawTechScene(c, W, H, t) {
    const u = Math.min(W, H) / 100;
    c.fillStyle = '#070b1a';
    c.fillRect(0, 0, W, H);

    const step = u * 7, off = (t * u * 6) % step;
    c.strokeStyle = 'rgba(45,212,191,0.16)';
    c.lineWidth = Math.max(1, u * 0.15);
    c.beginPath();
    for (let x = -step + off; x < W + step; x += step) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = -step + off; y < H + step; y += step) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();

    const title = 'BASIT ADS';
    const n = Math.floor(clamp(t / 2.5) * title.length);
    const cursor = n < title.length && Math.floor(t * 4) % 2 ? '_' : '';
    label(c, title.slice(0, n) + cursor, W / 2, H * 0.42, u * 9, '#fff', 900);

    c.globalAlpha = clamp((t - 3) / 1);
    label(c, 'The future of promo video is here', W / 2, H * 0.5, u * 3.8, '#2dd4bf', 600);
    c.globalAlpha = 1;

    const r = u * (12 + (Math.sin(t * 4) + 1) * 1.5);
    c.strokeStyle = '#7c5cff';
    c.lineWidth = Math.max(2, u * 0.6);
    c.beginPath();
    c.arc(W / 2, H * 0.7, r, 0, Math.PI * 2);
    c.stroke();

    const b = clamp((t - 6) / 0.5);
    if (b > 0) {
      c.globalAlpha = b;
      c.fillStyle = '#2dd4bf';
      rr(c, W / 2 - u * 26, H * 0.84, u * 52, u * 9, u * 4.5);
      c.fill();
      label(c, 'LAUNCHING SOON', W / 2, H * 0.84 + u * 4.5, u * 3.8, '#06201d', 900);
      c.globalAlpha = 1;
    }
  }

  function drawFitnessScene(c, W, H, t) {
    const u = Math.min(W, H) / 100;
    c.fillStyle = '#111';
    c.fillRect(0, 0, W, H);

    const n = 12, bw = W / n;
    for (let i = 0; i < n; i++) {
      const h = (Math.sin(t * 3 + i * 0.7) + 1.3) * H * 0.07;
      c.fillStyle = `hsl(${(i * 30 + t * 50) % 360} 90% 55%)`;
      c.fillRect(i * bw, H - h, bw - u * 0.6, h);
    }

    label(c, 'NO EXCUSES', W / 2, H * 0.18, u * 9, '#fff', 900);
    const reps = Math.floor(clamp(t / 8) * 100);
    label(c, String(reps), W / 2, H * 0.4, u * 26, '#ffd166', 900);
    label(c, 'REPS', W / 2, H * 0.5, u * 5, '#fff', 700);

    if (t > 8) {
      c.globalAlpha = clamp((t - 8) / 0.5);
      label(c, 'JOIN THE CHALLENGE', W / 2, H * 0.62, u * 4.5, '#fff', 800);
      c.globalAlpha = 1;
    }
  }

  window.BasitScenes = {
    samples: [
      { id: 'ecom', name: 'E-Commerce Product Showcase', desc: 'Product spin, price pop, call to action', duration: 10, draw: drawEcomScene },
      { id: 'tech', name: 'Tech Launch', desc: 'Animated grid, typed logo, launch badge', duration: 10, draw: drawTechScene },
      { id: 'fit', name: 'Fitness Promo', desc: 'Bold bars and a rep counter', duration: 10, draw: drawFitnessScene }
    ]
  };
})();
