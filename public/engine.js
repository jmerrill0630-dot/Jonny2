// Shared game engine. Runs on the Node server (multiplayer) OR directly in the
// browser (offline mode vs bots, e.g. when hosted on Vercel / GitHub Pages).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CFG = {
    WORLD: 5000,          // world is WORLD x WORLD
    FOOD: 1000,           // food pellets on the map
    BOTS: 10,             // AI players so the map is never empty
    TICK_MS: 1000 / 30,   // 30 ticks per second
    START_MASS: 10,
    MIN_SPLIT_MASS: 36,
    MIN_EJECT_MASS: 35,
    MAX_CELLS: 16,
    MERGE_MS: 12000,      // time before split cells can re-merge
    EAT_RATIO: 1.25,      // must be 25% bigger to eat another cell
  };

  const ADJ = ['Sneaky','Fluffy','Hungry','Speedy','Sparkly','Mighty','Sleepy','Spicy','Lucky','Bouncy','Cosmic','Turbo','Fuzzy','Chill','Wild','Jolly','Grumpy','Shiny','Brave','Silly'];
  const NOUN = ['Panda','Taco','Mop','Bubble','Tiger','Pickle','Noodle','Otter','Comet','Waffle','Llama','Ninja','Squid','Donut','Falcon','Potato','Yeti','Gecko','Muffin','Shark'];
  const COLORS = ['#ff5a5f','#ffb400','#00a699','#7b61ff','#3ec1d3','#ff7eb6','#5ad15a','#ff8c42','#4d96ff','#f15bb5'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const radius = (m) => Math.sqrt(m) * 7;
  const randomName = () => `${pick(ADJ)} ${pick(NOUN)} ${Math.floor(rand(1, 100))}`;
  const viewScale = (mass) => Math.pow(Math.max(mass, 10) / 10, 0.25);

  function createGame(overrides) {
    const cfg = Object.assign({}, CFG, overrides || {});
    const W = cfg.WORLD;
    let nextId = 1;
    const players = new Map();
    const food = [];
    let ejected = [];
    let timers = [];

    function placeFood(f) { f.x = rand(0, W); f.y = rand(0, W); f.c = Math.floor(Math.random() * COLORS.length); return f; }
    for (let i = 0; i < cfg.FOOD; i++) food.push(placeFood({}));

    const newCell = (x, y, mass) => ({ id: nextId++, x, y, mass, vx: 0, vy: 0, mergeAt: 0 });
    const makePlayer = (isBot, send) => ({ id: nextId++, name: randomName(), color: pick(COLORS), isBot, send, cells: [], dx: 0, dy: 0, alive: false, think: 0, best: 0 });
    const totalMass = (p) => p.cells.reduce((s, c) => s + c.mass, 0);
    function centroid(p) {
      let x = 0, y = 0, m = 0;
      for (const c of p.cells) { x += c.x * c.mass; y += c.y * c.mass; m += c.mass; }
      return m ? { x: x / m, y: y / m } : { x: W / 2, y: W / 2 };
    }

    function spawn(p) {
      // Spawn far from everyone else so you don't get eaten instantly
      let best = null, bestDist = -1;
      for (let i = 0; i < 25; i++) {
        const x = rand(200, W - 200), y = rand(200, W - 200);
        let nearest = Infinity;
        for (const o of players.values()) if (o !== p && o.alive) for (const c of o.cells)
          nearest = Math.min(nearest, Math.hypot(c.x - x, c.y - y) - radius(c.mass));
        if (nearest > bestDist) { bestDist = nearest; best = { x, y }; }
        if (nearest > 900) break;
      }
      p.cells = [newCell(best.x, best.y, cfg.START_MASS)];
      p.alive = true; p.dx = 0; p.dy = 0; p.best = cfg.START_MASS;
    }

    function split(p) {
      if (!p.alive) return;
      const c0 = centroid(p), now = Date.now(), add = [];
      for (const cell of p.cells) {
        if (p.cells.length + add.length >= cfg.MAX_CELLS) break;
        if (cell.mass < cfg.MIN_SPLIT_MASS) continue;
        cell.mass /= 2;
        const dx = c0.x + p.dx - cell.x, dy = c0.y + p.dy - cell.y, d = Math.hypot(dx, dy) || 1;
        const n = newCell(cell.x, cell.y, cell.mass);
        n.vx = (dx / d) * 28; n.vy = (dy / d) * 28;
        cell.mergeAt = n.mergeAt = now + cfg.MERGE_MS;
        add.push(n);
      }
      p.cells.push(...add);
    }

    function eject(p) {
      if (!p.alive) return;
      const c0 = centroid(p), now = Date.now();
      for (const cell of p.cells) {
        if (cell.mass < cfg.MIN_EJECT_MASS) continue;
        cell.mass -= 14;
        const dx = c0.x + p.dx - cell.x, dy = c0.y + p.dy - cell.y;
        const d = Math.hypot(dx, dy) || 1, r = radius(cell.mass);
        ejected.push({ x: cell.x + (dx / d) * r, y: cell.y + (dy / d) * r, vx: (dx / d) * 30, vy: (dy / d) * 30,
          mass: 12, c: COLORS.indexOf(p.color), owner: p.id, t: now });
      }
    }

    function botThink(p) {
      if (!p.alive || --p.think > 0) return;
      p.think = 6;
      const me = centroid(p);
      const big = p.cells.reduce((a, b) => (b.mass > a.mass ? b : a));
      const r = radius(big.mass);
      let threat = null, prey = null, td = Infinity, pd = Infinity;
      for (const o of players.values()) {
        if (o === p || !o.alive) continue;
        for (const c of o.cells) {
          const d = Math.hypot(c.x - me.x, c.y - me.y);
          if (c.mass > big.mass * cfg.EAT_RATIO && d < 350 + r + radius(c.mass) && d < td) { td = d; threat = c; }
          else if (big.mass > c.mass * cfg.EAT_RATIO && d < 500 + r && d < pd) { pd = d; prey = c; }
        }
      }
      if (threat) { p.dx = me.x - threat.x; p.dy = me.y - threat.y; return; }
      if (prey) { p.dx = prey.x - me.x; p.dy = prey.y - me.y; return; }
      let best = null, bd = Infinity;
      for (let i = 0; i < food.length; i += 3) {
        const f = food[i], d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2;
        if (d < bd) { bd = d; best = f; }
      }
      if (best) { p.dx = best.x - me.x; p.dy = best.y - me.y; }
    }

    function tick() {
      const now = Date.now();
      for (const p of players.values()) if (p.isBot) botThink(p);

      for (const p of players.values()) {
        if (!p.alive) continue;
        const c0 = centroid(p);
        for (const cell of p.cells) {
          const ddx = c0.x + p.dx - cell.x, ddy = c0.y + p.dy - cell.y, d = Math.hypot(ddx, ddy);
          const speed = 18 / Math.pow(cell.mass, 0.35);
          if (d > 1) { const f = Math.min(1, d / 60); cell.x += (ddx / d) * speed * f; cell.y += (ddy / d) * speed * f; }
          cell.x += cell.vx; cell.y += cell.vy; cell.vx *= 0.88; cell.vy *= 0.88;
          const r = radius(cell.mass);
          cell.x = clamp(cell.x, r / 2, W - r / 2); cell.y = clamp(cell.y, r / 2, W - r / 2);
          if (cell.mass > 100) cell.mass *= 0.9998;
        }
        for (let i = 0; i < p.cells.length; i++) {
          for (let j = i + 1; j < p.cells.length; j++) {
            const a = p.cells[i], b = p.cells[j];
            if (!a.mass || !b.mass) continue;
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
            const ra = radius(a.mass), rb = radius(b.mass);
            if (d >= ra + rb) continue;
            if (now > a.mergeAt && now > b.mergeAt) {
              if (d < Math.max(ra, rb)) { a.mass += b.mass; b.mass = 0; }
            } else {
              const push = (ra + rb - d) / 2;
              a.x -= (dx / d) * push; a.y -= (dy / d) * push;
              b.x += (dx / d) * push; b.y += (dy / d) * push;
            }
          }
        }
        p.cells = p.cells.filter((c) => c.mass > 0);
      }

      for (const e of ejected) {
        e.x = clamp(e.x + e.vx, 0, W); e.y = clamp(e.y + e.vy, 0, W);
        e.vx *= 0.88; e.vy *= 0.88;
      }

      const all = [];
      for (const p of players.values()) if (p.alive) for (const c of p.cells) all.push({ c, p });

      for (const { c, p } of all) {
        const r = radius(c.mass), r2 = r * r;
        for (const f of food) {
          const dx = f.x - c.x, dy = f.y - c.y;
          if (dx * dx + dy * dy < r2) { c.mass += 1; placeFood(f); }
        }
        for (const e of ejected) {
          if (!e.mass || (e.owner === p.id && now - e.t < 600)) continue;
          const dx = e.x - c.x, dy = e.y - c.y;
          if (dx * dx + dy * dy < r2) { c.mass += e.mass; e.mass = 0; }
        }
      }
      ejected = ejected.filter((e) => e.mass > 0);

      for (const A of all) {
        for (const B of all) {
          if (A.p === B.p || !A.c.mass || !B.c.mass) continue;
          if (A.c.mass <= B.c.mass * cfg.EAT_RATIO) continue;
          const d = Math.hypot(A.c.x - B.c.x, A.c.y - B.c.y);
          if (d < radius(A.c.mass) - radius(B.c.mass) * 0.4) { A.c.mass += B.c.mass; B.c.mass = 0; }
        }
      }

      for (const p of players.values()) {
        if (!p.alive) continue;
        p.cells = p.cells.filter((c) => c.mass > 0);
        if (p.cells.length === 0) {
          p.alive = false;
          if (p.isBot) timers.push(setTimeout(() => players.has(p.id) && spawn(p), 2000));
          else p.send('dead', { best: Math.floor(p.best) });
        } else {
          p.best = Math.max(p.best, totalMass(p));
        }
      }
      sendState();
    }

    function sendState() {
      const living = [...players.values()].filter((p) => p.alive);
      for (const p of players.values()) {
        if (p.isBot || !p.alive) continue;
        const c0 = centroid(p), mass = totalMass(p), vs = viewScale(mass);
        const half = 900 * vs;
        const inView = (x, y, r = 0) => Math.abs(x - c0.x) < half + r && Math.abs(y - c0.y) < half + r;
        const cells = [];
        for (const o of living) for (const c of o.cells) {
          if (inView(c.x, c.y, radius(c.mass)))
            cells.push({ i: c.id, o: o.id, x: Math.round(c.x), y: Math.round(c.y), m: Math.round(c.mass), n: o.name, c: o.color });
        }
        const f = [];
        for (const fo of food) if (inView(fo.x, fo.y)) f.push(Math.round(fo.x), Math.round(fo.y), fo.c);
        const e = [];
        for (const ej of ejected) if (inView(ej.x, ej.y)) e.push(Math.round(ej.x), Math.round(ej.y), ej.c);
        p.send('state', { cells, f, e, vs, mass: Math.floor(mass) });
      }
    }

    function sendLeaderboard() {
      const top = [...players.values()].filter((p) => p.alive)
        .map((p) => ({ id: p.id, n: p.name, m: Math.floor(totalMass(p)) }))
        .sort((a, b) => b.m - a.m).slice(0, 10);
      const humans = [...players.values()].filter((p) => !p.isBot);
      for (const p of humans) p.send('lb', { top, online: humans.length });
    }

    // Public API -----------------------------------------------------------
    // join(send) adds a human player. `send(event, data)` delivers events to them.
    function join(send, requestedName) {
      const p = makePlayer(false, send);
      const cleanName = String(requestedName || "").trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 24);
      if (cleanName) p.name = cleanName;
      players.set(p.id, p);
      spawn(p);
      send('init', { id: p.id, name: p.name, world: W });
      return {
        input(d) { if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) { p.dx = clamp(d.x, -3000, 3000); p.dy = clamp(d.y, -3000, 3000); } },
        split() { split(p); },
        eject() { eject(p); },
        respawn() {
          if (p.alive) return;
          spawn(p);
          send('init', { id: p.id, name: p.name, world: W });
        },
        leave() { players.delete(p.id); },
      };
    }

    function start() {
      for (let i = 0; i < cfg.BOTS; i++) { const b = makePlayer(true, null); players.set(b.id, b); spawn(b); }
      timers.push(setInterval(tick, cfg.TICK_MS));
      timers.push(setInterval(sendLeaderboard, 1000));
    }

    return { join, start };
  }

  return { createGame, CFG, radius };
});
