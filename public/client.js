// Jonny.io browser client for Vercel WebSockets.
const PHOTO_URL = 'me.jpg';
const COLORS = ['#ff5a5f','#ffb400','#00a699','#7b61ff','#3ec1d3','#ff7eb6','#5ad15a','#ff8c42','#4d96ff','#f15bb5'];
const radius = GameEngine.radius;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const photo = new Image();
photo.src = PHOTO_URL;
const $ = (id) => document.getElementById(id);

let socket = null, myId = null, world = 5000, state = null;
let cam = { x: 2500, y: 2500 }, zoom = 1;
let pointer = { x: innerWidth / 2, y: innerHeight / 2 };
let playerName = localStorage.getItem('jonnyPlayerName') || '';
let reconnectTimer = null, reconnectDelay = 1000, manuallyClosed = false;
const shown = new Map();

$('nameInput').value = playerName;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
}
addEventListener('resize', resize); resize();

function handleServerEvent(event, data) {
  if (event === 'init') {
    myId = data.id; world = data.world;
    $('myName').textContent = data.name;
    $('death').style.display = 'none';
    $('login').style.display = 'none';
    $('loginStatus').textContent = '';
    shown.clear();
  } else if (event === 'state') {
    state = data; $('myMass').textContent = data.mass;
  } else if (event === 'dead') {
    $('best').textContent = data.best; $('death').style.display = 'flex'; state = null;
  } else if (event === 'lb') {
    const ol = $('lbList'); ol.innerHTML = '';
    for (const p of data.top) {
      const li = document.createElement('li'); li.textContent = `${p.n} (${p.m})`;
      if (p.id === myId) li.className = 'me'; ol.appendChild(li);
    }
    const online = data.online || 0;
    $('online').textContent = `${online} player${online === 1 ? '' : 's'} online · live`;
  }
}

function send(type, data) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
}

function connect() {
  if (!playerName) return;
  clearTimeout(reconnectTimer);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/api/ws`;
  $('loginStatus').textContent = 'Connecting to multiplayer server…';
  const ws = new WebSocket(url);
  socket = ws;

  ws.addEventListener('open', () => {
    reconnectDelay = 1000;
    ws.send(JSON.stringify({ type: 'join', name: playerName }));
  });
  ws.addEventListener('message', (e) => {
    try { const msg = JSON.parse(e.data); handleServerEvent(msg.event, msg.data); } catch {}
  });
  ws.addEventListener('error', () => {
    if ($('login').style.display !== 'none') $('loginStatus').textContent = 'Could not connect. Check the Vercel deployment and try again.';
  });
  ws.addEventListener('close', () => {
    if (socket === ws) socket = null;
    if (manuallyClosed || !playerName) return;
    $('online').textContent = 'Reconnecting…';
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });
}

$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const clean = $('nameInput').value.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 24);
  if (!clean) { $('loginStatus').textContent = 'Enter a player name first.'; return; }
  playerName = clean; localStorage.setItem('jonnyPlayerName', clean);
  manuallyClosed = false;
  if (socket) try { socket.close(); } catch {}
  connect();
});

$('again').addEventListener('click', () => send('respawn'));
addEventListener('mousemove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });
function onTouch(e) {
  if (e.target !== canvas) return;
  const t = e.touches[0]; if (t) { pointer.x = t.clientX; pointer.y = t.clientY; }
  e.preventDefault();
}
canvas.addEventListener('touchstart', onTouch, { passive: false });
canvas.addEventListener('touchmove', onTouch, { passive: false });
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { send('split'); e.preventDefault(); }
  if (e.code === 'KeyW') send('eject');
});
for (const [id, action] of [['btnSplit','split'],['btnEject','eject']]) {
  $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); send(action); });
}
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
setInterval(() => send('input', { x: (pointer.x - innerWidth / 2) / zoom, y: (pointer.y - innerHeight / 2) / zoom }), 50);

function drawGrid() {
  const step = 50; ctx.strokeStyle = '#dde5ee'; ctx.lineWidth = 1 / zoom;
  const left = cam.x - innerWidth/2/zoom, top = cam.y - innerHeight/2/zoom;
  const right = cam.x + innerWidth/2/zoom, bottom = cam.y + innerHeight/2/zoom;
  ctx.beginPath();
  for (let x=Math.floor(left/step)*step; x<right; x+=step) { ctx.moveTo(x,top); ctx.lineTo(x,bottom); }
  for (let y=Math.floor(top/step)*step; y<bottom; y+=step) { ctx.moveTo(left,y); ctx.lineTo(right,y); }
  ctx.stroke(); ctx.strokeStyle='#ff5a5f'; ctx.lineWidth=8/zoom; ctx.strokeRect(0,0,world,world);
}
function drawCell(c,s) {
  const r=radius(s.m); ctx.save(); ctx.beginPath(); ctx.arc(s.x,s.y,r,0,Math.PI*2); ctx.closePath(); ctx.fillStyle=c.c; ctx.fill(); ctx.clip();
  if (photo.complete && photo.naturalWidth) ctx.drawImage(photo,s.x-r,s.y-r,r*2,r*2); ctx.restore();
  ctx.beginPath(); ctx.arc(s.x,s.y,r,0,Math.PI*2); ctx.lineWidth=Math.max(3,r*.08); ctx.strokeStyle=c.c; ctx.stroke();
  const fs=Math.max(13/zoom,r*.28); ctx.font=`700 ${fs}px system-ui, sans-serif`; ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.lineWidth=fs*.18; ctx.strokeStyle='#000'; ctx.fillStyle='#fff'; const label=c.o===myId?`${c.n} (you)`:c.n;
  ctx.strokeText(label,s.x,s.y+r+4); ctx.fillText(label,s.x,s.y+r+4);
}
function drawMinimap(mine) {
  const size=isTouch?90:140,pad=12,x0=isTouch?pad:innerWidth-size-pad,y0=innerHeight-size-pad;
  ctx.fillStyle='rgba(0,0,0,.3)'; ctx.fillRect(x0,y0,size,size); ctx.fillStyle='#ffd84d';
  for(const s of mine){ctx.beginPath();ctx.arc(x0+(s.x/world)*size,y0+(s.y/world)*size,3.5,0,Math.PI*2);ctx.fill();}
}
function frame(){
  requestAnimationFrame(frame); const dpr=canvas.width/innerWidth; ctx.setTransform(dpr,0,0,dpr,0,0); ctx.fillStyle='#f2f6fa'; ctx.fillRect(0,0,innerWidth,innerHeight); if(!state)return;
  const seen=new Set(); for(const c of state.cells){seen.add(c.i);const s=shown.get(c.i);if(!s)shown.set(c.i,{x:c.x,y:c.y,m:c.m});else{s.x+=(c.x-s.x)*.3;s.y+=(c.y-s.y)*.3;s.m+=(c.m-s.m)*.2;}}
  for(const id of shown.keys())if(!seen.has(id))shown.delete(id);
  const mine=state.cells.filter(c=>c.o===myId).map(c=>shown.get(c.i)); if(mine.length){let x=0,y=0,m=0;for(const s of mine){x+=s.x*s.m;y+=s.y*s.m;m+=s.m;}cam.x+=(x/m-cam.x)*.25;cam.y+=(y/m-cam.y)*.25;}
  const base=isTouch?720:1200,targetZoom=Math.max(innerWidth,innerHeight)/(base*state.vs); zoom+=(targetZoom-zoom)*.08;
  ctx.translate(innerWidth/2,innerHeight/2);ctx.scale(zoom,zoom);ctx.translate(-cam.x,-cam.y);drawGrid();
  for(let i=0;i<state.f.length;i+=3){ctx.fillStyle=COLORS[state.f[i+2]];ctx.beginPath();ctx.arc(state.f[i],state.f[i+1],7,0,Math.PI*2);ctx.fill();}
  for(let i=0;i<state.e.length;i+=3){ctx.fillStyle=COLORS[state.e[i+2]]||'#888';ctx.beginPath();ctx.arc(state.e[i],state.e[i+1],radius(12),0,Math.PI*2);ctx.fill();}
  for(const c of [...state.cells].sort((a,b)=>a.m-b.m))drawCell(c,shown.get(c.i)); ctx.setTransform(dpr,0,0,dpr,0,0); drawMinimap(mine);
}
requestAnimationFrame(frame);
