
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CATEGORIES = ['Nombre','Apellido','País','Ciudad','Animal','Fruta','Color','Objeto'];
const LETTERS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('');

app.use(express.static('public'));

const players = new Map();
const scores = new Map();
let hostId = null;
let phase = 'lobby';
let currentLetter = null;
let round = 0;
let remaining = 90;
let timer = null;
let answersByPlayer = new Map();

function playersPublic(){
  return [...players.entries()].map(([id,p])=>({
    id,name:p.name,score:scores.get(id)||0,isHost:id===hostId
  }));
}

function emitState(){
  io.emit('state',{
    phase,hostId,round,currentLetter,remaining,
    categories:CATEGORIES,players:playersPublic()
  });
}

function norm(v){
  return String(v||'').trim().toLocaleLowerCase('es')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

function validStart(v,l){
  return norm(v).startsWith(norm(l));
}

function stopTimer(){
  if(timer) clearInterval(timer);
  timer = null;
}

function scoreRound(){
  stopTimer();
  phase='results';

  const plist = playersPublic();
  const rows=[];

  for(const p of plist){
    const ans=answersByPlayer.get(p.id)||{};
    let rs=0;
    const details={};

    for(const cat of CATEGORIES){
      const a=String(ans[cat]||'').trim();

      if(!a || !validStart(a,currentLetter)){
        details[cat]={answer:a,points:0};
        continue;
      }

      let same=0;
      for(const op of plist){
        const oa=String((answersByPlayer.get(op.id)||{})[cat]||'').trim();
        if(norm(oa) && norm(oa)===norm(a)) same++;
      }

      const pts=same>1?5:10;
      rs+=pts;
      details[cat]={answer:a,points:pts};
    }

    scores.set(p.id,(scores.get(p.id)||0)+rs);

    rows.push({
      id:p.id,name:p.name,roundScore:rs,totalScore:scores.get(p.id),details
    });
  }

  io.emit('round-results',{
    letter:currentLetter,round,categories:CATEGORIES,rows
  });

  emitState();
}

function startRound(){
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
    if(socket.id!==hostId || phase!=='results') return;
    startRound();
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
    if(text) io.emit('chat-message',{name:players.get(socket.id).name,message:text});
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

server.listen(PORT,'0.0.0.0',()=>{
  console.log(`Tutifruti Multiplayer activo en puerto ${PORT}`);
});
