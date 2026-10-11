
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { DATABASE } from './database.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CATEGORIES = Object.keys(DATABASE);
const LETTERS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('');
const MAX_ROUNDS = 10;

app.use(express.static('.'));

const players = new Map();
const scores = new Map();
let hostId = null, phase = 'lobby', currentLetter = null, round = 0, remaining = 90, timer = null;
let answersByPlayer = new Map();

function normalize(v){
  return String(v||'').trim().toLocaleLowerCase('es')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

const DB_NORMALIZED = {};
for (const [cat, items] of Object.entries(DATABASE)) {
  DB_NORMALIZED[cat] = new Set(items.map(normalize));
}

function localValidation(category, answer, letter){
  const clean = String(answer||'').trim();

  if(!clean){
    return { valid:false, reason:'vacío' };
  }

  if(!normalize(clean).startsWith(normalize(letter))){
    return { valid:false, reason:`no empieza con ${letter}` };
  }

  if(!DB_NORMALIZED[category]?.has(normalize(clean))){
    return { valid:false, reason:'no está en la base local' };
  }

  return { valid:true, reason:'válido en base local' };
}

function publicPlayers(){
  return [...players.entries()].map(([id,p])=>({
    id,name:p.name,score:scores.get(id)||0,isHost:id===hostId
  }));
}

function emitState(){
  io.emit('state',{
    phase,hostId,round,maxRounds:MAX_ROUNDS,currentLetter,remaining,categories:CATEGORIES,players:publicPlayers()
  });
}

function stopTimer(){
  if(timer) clearInterval(timer);
  timer=null;
}

function scoreRound(){
  stopTimer();
  phase='results';

  const plist=publicPlayers();
  const rows=[];

  for(const p of plist){
    const answers=answersByPlayer.get(p.id)||{};
    let roundScore=0;
    const details={};

    for(const category of CATEGORIES){
      const answer=String(answers[category]||'').trim();
      const validation=localValidation(category,answer,currentLetter);

      if(!validation.valid){
        details[category]={
          answer,
          points:0,
          valid:false,
          reason:validation.reason
        };
        continue;
      }

      let repeated=0;

      for(const other of plist){
        const oa=String((answersByPlayer.get(other.id)||{})[category]||'').trim();
        if(normalize(oa) && normalize(oa)===normalize(answer)) repeated++;
      }

      const points=repeated>1?5:10;
      roundScore+=points;

      details[category]={
        answer,
        points,
        valid:true,
        reason:repeated>1?'válida pero repetida':'válida y única'
      };
    }

    scores.set(p.id,(scores.get(p.id)||0)+roundScore);

    rows.push({
      id:p.id,
      name:p.name,
      roundScore,
      totalScore:scores.get(p.id),
      details
    });
  }

  io.emit('round-results',{
    letter:currentLetter,
    round,
    categories:CATEGORIES,
    rows
  });

  emitState();
}

function startRound(){
  if(round >= MAX_ROUNDS){
    phase='results';
    emitState();
    return;
  }

  stopTimer();
  round++;
  phase='playing';
  answersByPlayer=new Map();

  let next=LETTERS[Math.floor(Math.random()*LETTERS.length)];
  while(next===currentLetter && LETTERS.length>1){
    next=LETTERS[Math.floor(Math.random()*LETTERS.length)];
  }

  currentLetter=next;
  remaining=90;

  io.emit('round-started',{
    round,letter:currentLetter,remaining,categories:CATEGORIES
  });

  emitState();

  timer=setInterval(()=>{
    remaining--;
    io.emit('timer',remaining);
    if(remaining<=0) scoreRound();
  },1000);
}

io.on('connection',socket=>{
  socket.on('join',({name})=>{
    const clean=String(name||'').trim().slice(0,20);

    if(!clean){
      socket.emit('join-result',{ok:false,message:'Ingresa tu nombre.'});
      return;
    }

    players.set(socket.id,{name:clean});
    scores.set(socket.id,0);

    if(!hostId) hostId=socket.id;

    socket.emit('join-result',{ok:true,id:socket.id});
    emitState();
  });

  socket.on('start-game',()=>{
    if(socket.id!==hostId) return;
    round=0;
    for(const id of players.keys()) scores.set(id,0);
    startRound();
  });

  socket.on('next-round',()=>{
    if(socket.id!==hostId || phase!=='results' || round>=MAX_ROUNDS) return;
    startRound();
  });

  socket.on('reset-game',()=>{
    if(socket.id!==hostId) return;

    stopTimer();
    phase='lobby';
    round=0;
    currentLetter=null;
    remaining=90;
    answersByPlayer=new Map();

    for(const id of players.keys()){
      scores.set(id,0);
    }

    io.emit('game-reset');
    emitState();
  });

  socket.on('submit-answers',answers=>{
    if(phase!=='playing' || !players.has(socket.id)) return;
    const clean={};
    for(const c of CATEGORIES) clean[c]=String(answers?.[c]||'').slice(0,60);
    answersByPlayer.set(socket.id,clean);
  });

  socket.on('stop-round',answers=>{
    if(phase!=='playing' || !players.has(socket.id)) return;
    const clean={};
    for(const c of CATEGORIES) clean[c]=String(answers?.[c]||'').slice(0,60);
    answersByPlayer.set(socket.id,clean);

    io.emit('stop-called',{by:players.get(socket.id).name});
    scoreRound();
  });


  socket.on('chat-message',msg=>{
    if(!players.has(socket.id)) return;

    const text=String(msg||'').trim().slice(0,140);

    if(text){
      io.emit('chat-message',{
        name:players.get(socket.id).name,
        message:text
      });
    }
  });

  socket.on('disconnect',()=>{
    const wasHost=socket.id===hostId;
    players.delete(socket.id);
    scores.delete(socket.id);
    answersByPlayer.delete(socket.id);

    if(wasHost) hostId=players.keys().next().value||null;

    if(players.size===0){
      stopTimer();
      phase='lobby';
      round=0;
      currentLetter=null;
      remaining=90;
    }

    emitState();
  });
});

server.listen(PORT,'0.0.0.0',()=>console.log(`Tutifruti Local DB activo en puerto ${PORT}`));
