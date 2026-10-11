
const socket=io();
let myId=null,state=null,categories=[];
const $=id=>document.getElementById(id);
const joinScreen=$('joinScreen'),game=$('game'),nameInput=$('nameInput'),joinBtn=$('joinBtn'),joinMsg=$('joinMsg');
const roundLabel=$('roundLabel'),letter=$('letter'),timer=$('timer'),playersEl=$('players');
const startBtn=$('startBtn'),nextBtn=$('nextBtn'),resetBtn=$('resetBtn'),lobbyCard=$('lobbyCard'),playArea=$('playArea'),categoriesEl=$('categories'),stopBtn=$('stopBtn');
const resultsArea=$('resultsArea'),resultsTable=$('resultsTable'),resultLetter=$('resultLetter'),stopOverlay=$('stopOverlay'),stopBy=$('stopBy');
const messages=$('messages'),chatInput=$('chatInput'),sendChat=$('sendChat');

joinBtn.onclick=()=>{joinMsg.textContent='Ingresando...';socket.emit('join',{name:nameInput.value});};
nameInput.addEventListener('keydown',e=>{if(e.key==='Enter')joinBtn.click();});
socket.on('join-result',d=>{if(!d.ok){joinMsg.textContent=d.message;return;}myId=d.id;joinScreen.classList.add('hidden');game.classList.remove('hidden');});

function collect(){const out={};for(const c of categories){const el=document.querySelector(`[data-category="${CSS.escape(c)}"]`);out[c]=el?.value||'';}return out;}
function renderInputs(){categoriesEl.innerHTML='';for(const c of categories){const w=document.createElement('div');w.className='category';const l=document.createElement('label');l.textContent=c;const i=document.createElement('input');i.dataset.category=c;i.placeholder=`${c} con ${state?.currentLetter||''}`;i.autocomplete='off';i.addEventListener('input',()=>socket.emit('submit-answers',collect()));w.append(l,i);categoriesEl.appendChild(w);}categoriesEl.querySelector('input')?.focus();}
function renderPlayers(ps){playersEl.innerHTML='';[...ps].sort((a,b)=>b.score-a.score).forEach(p=>{const r=document.createElement('div');r.className=`player-row ${p.isHost?'host':''}`;const n=document.createElement('div');n.textContent=`${p.name}${p.id===myId?' (Tú)':''}${p.isHost?' 👑':''}`;const s=document.createElement('div');s.className='score';s.textContent=`${p.score} pts`;r.append(n,s);playersEl.appendChild(r);});}

socket.on('state',s=>{
  state=s;
  categories=s.categories||categories;
  renderPlayers(s.players||[]);

  const isHost=s.hostId===myId;
  const max=s.maxRounds||10;

  startBtn.classList.toggle('hidden',!(s.phase==='lobby'&&isHost));
  nextBtn.classList.toggle('hidden',!(s.phase==='results'&&isHost&&s.round<max));
  resetBtn.classList.toggle('hidden',!(isHost&&s.round>0));

  letter.textContent=s.currentLetter||'?';
  timer.textContent=s.phase==='playing'?s.remaining:'--';

  lobbyCard.classList.toggle('hidden',s.phase!=='lobby');
  playArea.classList.toggle('hidden',s.phase!=='playing');
  resultsArea.classList.toggle('hidden',s.phase!=='results');

  if(s.phase==='lobby'){
    roundLabel.textContent='Sala de espera · 0/10 rondas';
  }else if(s.phase==='playing'){
    roundLabel.textContent=`Ronda ${s.round}/${max}`;
  }else{
    roundLabel.textContent=s.round>=max
      ? `PARTIDA FINALIZADA · Ronda ${s.round}/${max}`
      : `Resultados · Ronda ${s.round}/${max}`;
  }

  if(s.phase==='results' && s.round>=max){
    nextBtn.classList.add('hidden');
  }
});
socket.on('round-started',d=>{categories=d.categories;if(!state)state={};state.currentLetter=d.letter;letter.textContent=d.letter;timer.textContent=d.remaining;renderInputs();});
socket.on('timer',v=>timer.textContent=v);
startBtn.onclick=()=>socket.emit('start-game');
nextBtn.onclick=()=>socket.emit('next-round');

resetBtn.onclick=()=>{
  if(confirm('¿Reiniciar la partida? Todos volverán a 0 puntos y la ronda regresará a 0.')){
    socket.emit('reset-game');
  }
};

socket.on('game-reset',()=>{
  resultsTable.innerHTML='';
  resultLetter.textContent='';
  categoriesEl.innerHTML='';
  letter.textContent='?';
  timer.textContent='--';
});
stopBtn.onclick=()=>socket.emit('stop-round',collect());
socket.on('stop-called',d=>{stopBy.textContent=`${d.by} detuvo la ronda.`;stopOverlay.classList.remove('hidden');setTimeout(()=>stopOverlay.classList.add('hidden'),1200);});

socket.on('round-results',d=>{
  resultLetter.textContent=`Letra: ${d.letter}`;
  const head=`<thead><tr><th>Jugador</th>${d.categories.map(c=>`<th>${esc(c)}</th>`).join('')}<th>Ronda</th><th>Total</th></tr></thead>`;
  const body=d.rows.sort((a,b)=>b.totalScore-a.totalScore).map(r=>{
    const cells=d.categories.map(c=>{
      const x=r.details[c],cls=x.points===10?'p10':x.points===5?'p5':'p0';
      return `<td><div class="answer"><span>${esc(x.answer||'—')}</span><small class="${cls}">+${x.points}</small><div class="reason">${esc(x.reason||'')}</div></div></td>`;
    }).join('');
    return `<tr><td><b>${esc(r.name)}</b></td>${cells}<td><b>${r.roundScore}</b></td><td><b>${r.totalScore}</b></td></tr>`;
  }).join('');
  resultsTable.innerHTML=head+`<tbody>${body}</tbody>`;
});


function sendChatMessage(){
  const text=chatInput.value.trim();
  if(!text) return;
  socket.emit('chat-message',text);
  chatInput.value='';
}

sendChat.onclick=sendChatMessage;

chatInput.addEventListener('keydown',e=>{
  if(e.key==='Enter') sendChatMessage();
});

socket.on('chat-message',d=>{
  const row=document.createElement('div');
  row.className='chat-message';

  const strong=document.createElement('strong');
  strong.textContent=`${d.name}: `;

  const span=document.createElement('span');
  span.textContent=d.message;

  row.append(strong,span);
  messages.appendChild(row);
  messages.scrollTop=messages.scrollHeight;
});

function esc(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");}
