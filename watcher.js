// SUI 감시기 (GitHub Actions용) — 시세만 읽어 신호 계산 후 상태가 바뀌면 텔레그램 전송
// 계좌 권한 없음. 매매 실행 없음. 알림 전용.
const fs = require('fs');

// ---------- 지표 ----------
function ema(v,p){const o=Array(v.length).fill(null);const k=2/(p+1);let pr=null;for(let i=0;i<v.length;i++){if(pr==null){if(i>=p-1){let s=0;for(let j=i-p+1;j<=i;j++)s+=v[j];pr=s/p;o[i]=pr;}}else{pr=v[i]*k+pr*(1-k);o[i]=pr;}}return o;}
function rsi(v,p=14){const o=Array(v.length).fill(null);if(v.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){const c=v[i]-v[i-1];if(c>=0)g+=c;else l-=c;}let ag=g/p,al=l/p;o[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<v.length;i++){const c=v[i]-v[i-1];const gi=c>0?c:0,li=c<0?-c:0;ag=(ag*(p-1)+gi)/p;al=(al*(p-1)+li)/p;o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function trendOf(cd){const c=cd.map(x=>x.close),e50=ema(c,50),e200=ema(c,200),L=c.length-1,p=c[L];if(e50[L]==null||e200[L]==null)return'?';if(p>e50[L]&&e50[L]>e200[L])return'상승';if(p<e50[L]&&e50[L]<e200[L])return'하락';return'횡보';}
function pricePos(cd,W){const n=cd.length,L=n-1,s=Math.max(0,L-W+1);let lo=Infinity,hi=-Infinity;for(let j=s;j<=L;j++){if(cd[j].low<lo)lo=cd[j].low;if(cd[j].high>hi)hi=cd[j].high;}return{pos:hi>lo?(cd[L].close-lo)/(hi-lo)*100:50,lo,hi};}

// ---------- 신호 (브라우저 감시기와 동일 로직) ----------
function fnum(v){return v>=1?v.toLocaleString('en-US',{maximumFractionDigits:2}):Number(v).toPrecision(4);}
function signal(SUI,BTC){
  const c=SUI.map(x=>x.close),L=c.length-1,price=c[L];
  const chg=(c[L]/c[L-1]-1)*100;
  const W=Math.min(365,SUI.length);const{pos}=pricePos(SUI,W);
  const r=rsi(c,14)[L];const st=trendOf(SUI),bt=trendOf(BTC);
  let state,act,desc;
  if(pos<=15&&r<=45){state='fire';act='🔥 적극 매수';desc=`SUI가 1년 범위 하위 ${pos.toFixed(0)}%, RSI ${r.toFixed(0)}. 스윙 물량 적극 진입 검토 자리.`;}
  else if(pos<=30&&r<60){state='buy';act='🟢 분할 매수';desc=`범위 하단부(${pos.toFixed(0)}%). 추격 말고 정해둔 금액만 분할 매수.`;}
  else if(pos>=70){state='sell';act='🟠 분할 익절';desc=`범위 상단부(${pos.toFixed(0)}%), RSI ${r.toFixed(0)}. 비싼 구간 — 일부 현금화, 신규 매수 금지.`;}
  else{state='wait';act='🟡 대기';desc=`범위 중간(${pos.toFixed(0)}%). 매수·익절 조건 미충족.`;}
  let caut='';
  if((state==='fire'||state==='buy')&&bt==='하락')caut='\n⚠ BTC 하락추세 — 알트는 더 빠질 수 있으니 소량·분할.';
  else if((state==='fire'||state==='buy')&&st==='하락'&&r>38)caut='\n⚠ SUI 하락추세 지속 — 전저점 지지 확인 후 분할.';
  return {state,act,desc:desc+caut,price,chg,pos:Math.round(pos),rsi:Math.round(r),suiTrend:st,btcTrend:bt};
}

// ---------- 데이터 ----------
async function klines(sym){
  const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=1000`);
  if(!r.ok)throw new Error(sym+' HTTP '+r.status);
  return (await r.json()).map(k=>({open:+k[1],high:+k[2],low:+k[3],close:+k[4]}));
}
async function sendTelegram(token,chatId,text){
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})
  });
  if(!r.ok)throw new Error('Telegram HTTP '+r.status+' '+await r.text());
}

// ---------- 상태 저장 (상태 바뀔 때만 알림) ----------
const STATE_FILE='state.json';
function readPrev(){try{return JSON.parse(fs.readFileSync(STATE_FILE,'utf8')).state;}catch{return null;}}
function writeState(state){fs.writeFileSync(STATE_FILE,JSON.stringify({state,ts:new Date().toISOString()},null,2));}
function shouldNotify(next,prev){return ['fire','buy','sell'].includes(next)&&next!==prev;}

function buildMessage(s){
  return `${s.act}\n`
    + `SUI $${fnum(s.price)} (${s.chg>=0?'+':''}${s.chg.toFixed(1)}%)\n`
    + `범위위치 ${s.pos}% · RSI ${s.rsi} · SUI ${s.suiTrend}·BTC ${s.btcTrend}\n\n`
    + `${s.desc}\n\n`
    + `차트: https://www.tradingview.com/chart/?symbol=BINANCE:SUIUSDT`;
}

async function main(){
  // SELFTEST: 네트워크/토큰 없이 메시지 조립만 검증
  if(process.env.SELFTEST){
    const mk=cl=>cl.map(c=>({open:c,high:c*1.02,low:c*0.98,close:c}));
    let d=[];for(let i=0;i<400;i++)d.push(100-i*0.2);for(let i=0;i<10;i++)d.push(d[d.length-1]-1.5);
    const s=signal(mk(d),mk(Array.from({length:420},()=>50000)));
    console.log('--- SELFTEST 메시지 ---\n'+buildMessage(s));
    console.log('\nstate=',s.state,'| notify(wait->'+s.state+')=',shouldNotify(s.state,'wait'));
    return;
  }

  const token=process.env.TELEGRAM_TOKEN, chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId){console.error('TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 시크릿이 없습니다.');process.exit(1);}

  let SUI,BTC;
  try{[SUI,BTC]=await Promise.all([klines('SUIUSDT'),klines('BTCUSDT')]);}
  catch(e){console.error('데이터 조회 실패:',e.message);process.exit(0);} // 실패해도 액션은 성공 처리(알림 메일 방지)

  const s=signal(SUI,BTC);
  const prev=readPrev();
  console.log(`상태 ${prev} -> ${s.state} (pos ${s.pos}%, rsi ${s.rsi})`);
  if(shouldNotify(s.state,prev)){
    try{await sendTelegram(token,chatId,buildMessage(s));console.log('텔레그램 전송 완료');}
    catch(e){console.error('전송 실패:',e.message);}
  }else{
    console.log('상태 변화 없음 또는 대기 상태 — 알림 생략');
  }
  writeState(s.state);
}
main();
