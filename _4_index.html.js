/* ===================== PWA + โหมดออฟไลน์ ===================== */

/* --- ลงทะเบียน Service Worker --- */
if('serviceWorker' in navigator){
  window.addEventListener('load', async ()=>{
    try{
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', ()=>{
        const nw = reg.installing;
        nw.addEventListener('statechange', ()=>{
          if(nw.state === 'installed' && navigator.serviceWorker.controller){
            if(confirm('มีเวอร์ชันใหม่ของแอป ต้องการอัปเดตตอนนี้หรือไม่?')){
              nw.postMessage('SKIP_WAITING');
              location.reload();
            }
          }
        });
      });
    }catch(err){ console.warn('SW ลงทะเบียนไม่สำเร็จ', err); }
  });
  navigator.serviceWorker.addEventListener('message', e=>{
    if(e.data && e.data.type === 'FLUSH_OUTBOX') flushOutbox();
  });
}

/* --- ปุ่มติดตั้ง --- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault(); deferredPrompt = e;
  if(!localStorage.getItem('tww_installed')) installBar.classList.add('on');
});
async function doInstall(){
  installBar.classList.remove('on');
  if(!deferredPrompt){
    alert('บน iPhone/iPad: กดปุ่มแชร์ ⬆️ ที่แถบล่างของ Safari แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"');
    return;
  }
  deferredPrompt.prompt();
  const r = await deferredPrompt.userChoice;
  if(r.outcome === 'accepted') localStorage.setItem('tww_installed','1');
  deferredPrompt = null;
}
window.addEventListener('appinstalled', ()=>{
  localStorage.setItem('tww_installed','1');
  installBar.classList.remove('on');
});

/* --- สถานะออนไลน์/ออฟไลน์ --- */
function setNet(){
  const off = !navigator.onLine;
  offbar.classList.toggle('on', off || !online);
  const q = outbox().length;
  pend.innerHTML = q ? '<span class="pending">ค้างส่ง ' + q + ' รายการ</span>' : '';
}
window.addEventListener('online',  ()=>{ setNet(); flushOutbox(); pull(); });
window.addEventListener('offline', setNet);

/* --- กล่องรอส่ง (Outbox) --- */
const outbox    = ()=> JSON.parse(localStorage.getItem('tww_outbox') || '[]');
const setOutbox = v => localStorage.setItem('tww_outbox', JSON.stringify(v));

function queue(payload){
  const q = outbox();
  q.push({ ...payload, _qid: Date.now() + '-' + Math.random().toString(36).slice(2,7) });
  setOutbox(q); setNet();
  if('serviceWorker' in navigator && 'SyncManager' in window){
    navigator.serviceWorker.ready.then(r => r.sync.register('flush-outbox').catch(()=>{}));
  }
}

async function flushOutbox(){
  const q = outbox();
  if(!q.length || !navigator.onLine) return;
  const left = [];
  for(const item of q){
    try{
      const { _qid, ...body } = item;
      const r = await push(body);
      if(!r.ok) left.push(item);
    }catch(e){ left.push(item); }
  }
  setOutbox(left); setNet();
  if(left.length < q.length){
    toast('ส่งรายงานที่ค้างไว้สำเร็จ ' + (q.length - left.length) + ' รายการ');
    pull();
  }
}

/* --- แคชข้อมูลล่าสุดไว้เปิดตอนออฟไลน์ --- */
const cacheSnap = ()=> localStorage.setItem('tww_snap',
  JSON.stringify({ levels, reports, rain, at: Date.now() }));

function loadSnap(){
  const s = JSON.parse(localStorage.getItem('tww_snap') || 'null');
  if(s){ levels = s.levels; reports = s.reports; rain = s.rain; return s.at; }
  return null;
}

/* --- ครอบ pull/addReport/saveLevel เดิมให้รองรับออฟไลน์ --- */
const _pull = pull;
pull = async function(){
  if(!navigator.onLine){
    const at = loadSnap(); online = false; render(); setNet();
    if(at) clock.textContent = 'ข้อมูลล่าสุดเมื่อ ' + new Date(at).toLocaleString('th-TH');
    return;
  }
  await _pull();
  if(online) cacheSnap();
  setNet();
};

const _addReport = addReport;
addReport = async function(){
  const loc = rLoc.value.trim();
  if(!loc) return alert('กรุณาระบุสถานที่');
  if(!navigator.onLine){
    queue({ action:'add_report', loc:loc, depth:+rDep.value, note:rNote.value.trim(),
            lat: gps?gps[0]:LAT, lon: gps?gps[1]:LON });
    reports.unshift({ id:'local', ts:Date.now(), loc:loc + ' (รอส่ง)', d:+rDep.value,
                      note:rNote.value.trim(), lat: gps?gps[0]:LAT, lon: gps?gps[1]:LON });
    cacheSnap(); rLoc.value = rNote.value = ''; gps = null; render();
    gpsMsg.innerHTML = '<small style="color:#a855f7">บันทึกไว้แล้ว จะส่งอัตโนมัติเมื่อมีสัญญาณ</small>';
    return;
  }
  await _addReport(); cacheSnap();
};

const _saveLevel = saveLevel;
saveLevel = async function(){
  const v = parseFloat(sVal.value);
  if(isNaN(v)) return alert('กรุณากรอกตัวเลข');
  if(!navigator.onLine){
    queue({ action:'save_level', station:sPick.value, value:v, by:(sBy.value.trim()||'เจ้าหน้าที่') });
    levels[sPick.value] = { v:v, ts:Date.now(), by:'(รอส่ง)' };
    cacheSnap(); sVal.value=''; render();
    alert('บันทึกไว้ในเครื่องแล้ว จะส่งขึ้นระบบอัตโนมัติเมื่อมีสัญญาณ');
    return;
  }
  await _saveLevel(); cacheSnap();
};

/* --- แจ้งเตือนสั้น ๆ บนจอ --- */
function toast(msg){
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:80px;z-index:99999;'+
    'background:#16a34a;color:#fff;padding:12px 22px;border-radius:10px;font-size:14px;'+
    'box-shadow:0 6px 20px rgba(0,0,0,.4)';
  document.body.appendChild(d);
  setTimeout(()=>d.remove(), 3500);
}

/* --- เปิดจาก shortcut ตรงไปหน้าที่ต้องการ --- */
(function(){
  const p = new URLSearchParams(location.search).get('page');
  const idx = { report:3, input:4 }[p];
  if(idx !== undefined){
    const btns = document.querySelectorAll('nav button');
    go(idx, btns[idx]);
  }
})();

/* --- เริ่มทำงาน --- */
loadSnap(); setNet(); flushOutbox();