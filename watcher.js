// 돌파 감시기 (GitHub Actions용) — SUI·SOL·BNB
// 20일 신고가 돌파 + 거래량 급증 시 텔레그램 알림. 시세만 읽음, 계좌 권한 없음, 매매 실행 없음.
const fs = require('fs');

// ===== 설정 =====
const COINS = ['SUI', 'SOL', 'BNB'];   // 감시 코인
const VOL_MULT = 1.5;                   // 돌파 거래량 배수 기준
const STOP_CAP_PCT = 15;               // 손절 상한 %
const HIGH_LOOKBACK = 20;              // 신고가 기준 봉수

// ===== 지표 =====
function sma(v,p){const o=Array(v.length).fill(null);let s=0;for(let i=0;i<v.length;i++){s+=v[i];if(i>=p)s-=v[i-p];if(i>=p-1)o[i]=s/p;}return o;}
function atr(hi,lo,c,p=14){const tr=[];for(let i=0;i<c.length;i++){if(i===0){tr.push(hi[i]-lo[i]);continue;}tr.push(Math.max(hi[i]-lo[i],Math.abs(hi[i]-c[i-1]),Math.abs(lo[i]-c[i-1])));}const o=Array(c.length).fill(null);let a=null;for(let i=0;i<c.length;i++){if(i<p){if(i===p-1){let s=0;for(let j=0;j<p;j++)s+=tr[j];a=s/p;o[i]=a;}}else{a=(a*(p-1)+tr[i])/p;o[i]=a;}}return o;}
function fnum(v){return v>=1?v.toLocaleString('en-US',{maximumFractionDigits:2}):Number(v).toPrecision(4);}

// ===== 돌파 신호 + 매매 플랜 =====
function signal(cd){
  const c=cd.map(x=>x.close),hi=cd.map(x=>x.high),lo=cd.map(x=>x.low),vol=cd.map(x=>x.volume);
  const L=c.length-1;const vs=sma(vol,20),a=atr(hi,lo,c,14);
  const price=c[L],chg=(c[L]/c[L-1]-1)*100;
  const prevHigh=Math.max(...hi.slice(L-HIGH_LOOKBACK,L)); // 오늘 제외 직전 20봉 최고가
  const volR=vs[L]?vol[L]/vs[L]:0;
  const isBreakout = price>prevHigh && volR>=VOL_MULT;
  // 매매 플랜
  const swingLow=Math.min(...lo.slice(Math.max(0,L-9),L+1));
  let stop=swingLow-(a[L]?0.3*a[L]:0);
  if(!(stop<price*0.999))stop=price-(a[L]?1.5*a[L]:price*0.03);
  if((price-stop)/price*100>STOP_CAP_PCT)stop=price*(1-STOP_CAP_PCT/100);
  const risk=price-stop,t1=price+1.5*risk,t2=price+3*risk;
  return {isBreakout,price,chg,prevHigh,volR,stop,stopPct:(price-stop)/price*100,t1,t2};
}
function message(coin,s){
  return `🚀 ${coin} 돌파 신호\n`
   +`${coin} $${fnum(s.price)} (${s.chg>=0?'+':''}${s.chg.toFixed(1)}%)\n`
   +`20일 신고가 $${fnum(s.prevHigh)} 돌파 · 거래량 ${s.volR.toFixed(1)}배\n\n`
   +`진입 ${fnum(s.price)} 부근\n`
   +`손절 ${fnum(s.stop)} (-${s.stopPct.toFixed(0)}%)\n`
   +`익절1 ${fnum(s.t1)} (+1.5R) 반액 후 손절 본전 이동\n`
   +`익절2 ${fnum(s.t2)} (+3R) 잔량\n\n`
   +`※ 소액·분할. 돌파는 실패도 잦으니 손절 지키기.\n`
   +`차트: https://www.tradingview.com/chart/?symbol=BINANCE:${coin}USDT`;
}

// ===== 데이터 · 전송 =====
async function klines(sym){
  const r=await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=200`);
  if(!r.ok)throw new Error(sym+' HTTP '+r.status);
  return (await r.json()).map(k=>({high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}));
}
async function sendTelegram(token,chatId,text){
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});
  if(!r.ok)throw new Error('Telegram '+r.status+' '+await r.text());
}

// ===== 상태(코인별 돌파 여부) 저장 → 돌파 시작될 때만 알림 =====
const STATE_FILE='state.json';
function readPrev(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));}catch{return {};}}
function writeState(st){fs.writeFileSync(STATE_FILE,JSON.stringify({...st,ts:new Date().toISOString()},null,2));}

async function main(){
  if(process.env.SELFTEST){
    const mk=()=>{const cd=[];let p=10;for(let i=0;i<60;i++){p=10+Math.sin(i/5)*0.3;cd.push({high:p*1.01,low:p*0.99,close:p,volume:100});}cd.push({high:11.6,low:10.2,close:11.5,volume:300});return cd;};
    console.log(message('SUI',signal(mk())));return;
  }
  const token=process.env.TELEGRAM_TOKEN, chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId){console.error('TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 시크릿이 없습니다.');process.exit(1);}

  const prev=readPrev();const next={};
  for(const coin of COINS){
    let cd;
    try{cd=await klines(coin);}catch(e){console.error(coin,'데이터 실패:',e.message);next[coin]=prev[coin]||0;continue;}
    const s=signal(cd);
    const now=s.isBreakout?1:0;
    next[coin]=now;
    console.log(`${coin}: 돌파=${now} (가격 ${fnum(s.price)}, 20일고가 ${fnum(s.prevHigh)}, 거래량 ${s.volR.toFixed(1)}배)`);
    if(now===1 && prev[coin]!==1){ // 돌파가 새로 발생한 순간만
      try{await sendTelegram(token,chatId,message(coin,s));console.log(`  → ${coin} 알림 전송`);}
      catch(e){console.error('  전송 실패:',e.message);}
    }
  }
  writeState(next);
}
main();
