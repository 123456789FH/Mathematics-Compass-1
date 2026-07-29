const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const arDigits=v=>String(v??'').replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const formatDate=v=>v?new Date(v).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric'}):'—';
const statusText={open:'جديد',in_progress:'قيد المعالجة',resolved:'تمت المعالجة'};
const recoveryStatusText={open:'بانتظار المراجعة',approved:'تمت الموافقة',rejected:'مرفوض',expired:'منتهي الصلاحية',invalid:'الرمز غير صحيح'};
const roleText={member:'عضو',supervisor:'مشرف',admin:'مدير المنصة'};
const titles={home:['الرئيسية','مؤشراتك الشخصية وخطوتك التالية'],diagnostic:['التشخيص الذكي','بناء بصمة الاحتياج الرياضي'],practice:['بنك المسائل','تدريب مهني مع تفسير وفخ شائع'],needs:['احتياجي','إرسال الاحتياج ومتابعة معالجته'],courses:['الدورات والمسارات','مصادر مقترحة وفق الاحتياج'],supervisor:['نبض الملتقى','مؤشرات حقيقية لدعم قرار المشرف'],content:['إدارة المحتوى','الأسئلة والدورات والإعلانات']};

const state={backend:null,mode:'demo',session:null,profile:null,skills:[],page:'home',dashboard:null,diagnostic:null,practice:[],allNeeds:[],adminQuestions:[],adminCourses:[],adminAnnouncements:[],adminMembers:[],adminRecoveries:[],unsubscribe:null};

function toast(message,type='info'){
  const el=$('#toast');el.textContent=message;el.style.background=type==='error'?'#8b2731':type==='success'?'#235c36':'#082a50';el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),3200);
}
function setBusy(button,busy,label='جارٍ التنفيذ...'){if(!button)return;if(busy){button.dataset.old=button.textContent;button.disabled=true;button.textContent=label}else{button.disabled=false;button.textContent=button.dataset.old||button.textContent}}
function setBanner(message,kind=''){
  const el=$('#connectionBanner');
  if(kind==='online'){el.textContent='';el.className='connection-banner hidden';return}
  el.textContent=message;el.className=`connection-banner ${kind}`;el.classList.remove('hidden')
}
function closeModal(){$('#modalBackdrop').classList.add('hidden');$('#modalBody').innerHTML=''}
function openModal(title,html){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;$('#modalBackdrop').classList.remove('hidden')}
function isStaff(){return ['supervisor','admin'].includes(state.profile?.role)}
function skillName(id){return state.skills.find(s=>s.id===id)?.name||'عام'}
function percentColor(p){return p<50?'var(--red)':p<70?'var(--orange)':'var(--green)'}

async function createBackend(){
  const c=window.BOUSLA_CONFIG||{};
  const configured=!c.DEMO_MODE&&/^https:\/\/.+\.supabase\.co$/.test(c.SUPABASE_URL||'')&&(c.SUPABASE_ANON_KEY||'').startsWith('sb_publishable_');
  if(c.DEMO_MODE){
    const {DemoBackend}=await import('./demo-backend.js');
    state.mode='demo';
    setBanner('الوضع التجريبي يعمل على هذا الجهاز فقط.');
    $('#demoAccounts')?.classList.remove('hidden');
    return new DemoBackend();
  }
  if(!configured)throw new Error('بيانات ربط Supabase غير مكتملة في js/config.js.');
  const {SupabaseBackend}=await import('./supabase-backend.js');
  state.mode='live';
  setBanner('متصلة بقاعدة البيانات — بيانات الأعضاء محفوظة ومشتركة.','online');
  return new SupabaseBackend(c);
}

function authSubmitButtons(){return $$('#loginForm button[type="submit"], #signupForm button[type="submit"]')}
function setAuthReady(ready){authSubmitButtons().forEach(button=>{button.disabled=!ready;button.setAttribute('aria-disabled',String(!ready))})}

async function init(){
  bindStaticEvents();
  setAuthReady(false);
  setBanner('جارٍ الاتصال بقاعدة البيانات...','');
  try{
    state.backend=await createBackend();
    state.backend.onAuthStateChange(async(event,session)=>{if(event==='SIGNED_OUT'){showAuth();return}if(session&&!state.session){await enterApp(session)}});
    const {session,profile}=await state.backend.initialize();
    if(session){state.profile=profile;await enterApp(session)}else showAuth();
    setAuthReady(true);
  }catch(error){
    console.error(error);
    state.backend=null;
    setBanner(`تعذر الاتصال بقاعدة البيانات: ${translateError(error.message)}`,'error');
    toast(translateError(error.message),'error');
    showAuth();
    setAuthReady(true);
  }
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(error=>console.warn('Service worker:',error));
}

function bindStaticEvents(){
  $('#loginTab').addEventListener('click',()=>switchAuth('login'));
  $('#signupTab').addEventListener('click',()=>switchAuth('signup'));
  $('#loginForm').addEventListener('submit',handleLogin);
  $('#signupForm').addEventListener('submit',handleSignup);
  $('#forgotAccessBtn')?.addEventListener('click',showAccessRecovery);
  $('#demoAccounts').addEventListener('click',e=>{const role=e.target.dataset.demoLogin;if(!role)return;$('#loginName').value=role==='member'?'عضو تجريبي':'مشرف تجريبي';$('#loginMemberNumber').value=role==='member'?'11111':'22222';$('#loginForm').requestSubmit()});
  $('#logoutBtn').addEventListener('click',()=>state.backend.signOut().catch(e=>toast(e.message,'error')));
  $('#refreshBtn').addEventListener('click',()=>refreshPage(true));
  $('#mainNav').addEventListener('click',navClick);
  $('#mobileNav').addEventListener('click',navClick);
  document.addEventListener('click',e=>{const go=e.target.closest('[data-go]')?.dataset.go;if(go)navigate(go)});
  $('#modalClose').addEventListener('click',closeModal);
  $('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
  $('#startDiagnosticBtn').addEventListener('click',startDiagnostic);
  $('#diagnosticCheckBtn').addEventListener('click',checkDiagnostic);
  $('#diagnosticNextBtn').addEventListener('click',nextDiagnostic);
  $('#loadQuestionsBtn').addEventListener('click',loadPractice);
  $('#practiceList').addEventListener('click',e=>{const id=e.target.closest('[data-question-id]')?.dataset.questionId;if(id)openPractice(id)});
  $('#needForm').addEventListener('submit',submitNeed);
  $('#supervisorNeeds').addEventListener('change',e=>{if(e.target.matches('[data-need-status]'))updateNeedStatus(e.target.dataset.needStatus,e.target.value)});
  $('#exportNeedsBtn').addEventListener('click',exportNeedsCsv);
  $('.content-tabs').addEventListener('click',e=>{const tab=e.target.dataset.contentTab;if(tab)switchContentTab(tab)});
  $('#newQuestionBtn').addEventListener('click',()=>questionForm());
  $('#newCourseBtn').addEventListener('click',()=>courseForm());
  $('#newAnnouncementBtn').addEventListener('click',()=>announcementForm());
  $('#adminQuestions').addEventListener('click',adminQuestionAction);
  $('#adminCourses').addEventListener('click',adminCourseAction);
  $('#adminAnnouncements').addEventListener('click',adminAnnouncementAction);
  $('#adminMembers').addEventListener('change',e=>{if(e.target.matches('[data-profile-role]'))updateMemberRole(e.target.dataset.profileRole,e.target.value)});
  $('#refreshRecoveriesBtn')?.addEventListener('click',()=>loadAdminRecoveries());
  $('#adminRecoveries')?.addEventListener('click',adminRecoveryAction);
}
const RECOVERY_STORAGE_KEY='bousla-access-recovery-token-v1';
function generateRecoveryToken(){
  const bytes=new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function copyText(value){
  try{await navigator.clipboard.writeText(value);toast('تم النسخ.','success')}
  catch{
    const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();toast('تم النسخ.','success')
  }
}
function recoveryDate(value){return value?new Date(value).toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'}):'—'}
function switchRecoveryPanel(mode){
  const request=mode==='request';
  $('#recoveryRequestTab')?.classList.toggle('active',request);
  $('#recoveryCheckTab')?.classList.toggle('active',!request);
  $('#recoveryRequestPanel')?.classList.toggle('hidden',!request);
  $('#recoveryCheckPanel')?.classList.toggle('hidden',request);
}
function showAccessRecovery(){
  const savedToken=localStorage.getItem(RECOVERY_STORAGE_KEY)||'';
  const savedName=$('#loginName')?.value?.trim()||localStorage.getItem('bousla-recovery-name')||'';
  openModal('استعادة رقم الدخول',`
    <section class="recovery-info">
      <div class="recovery-intro">
        <div class="recovery-icon" aria-hidden="true">↺</div>
        <div><h3>استعادة رقم الدخول</h3><p>أرسلي طلبًا من داخل المنصة، واحفظي رمز المتابعة. بعد أن يتحقق مدير المنصة من هويتك ويوافق على الطلب، سيظهر رقم الدخول هنا.</p></div>
      </div>
      <div class="recovery-tabs">
        <button id="recoveryRequestTab" class="active" type="button">طلب جديد</button>
        <button id="recoveryCheckTab" type="button">متابعة طلب</button>
      </div>
      <div id="recoveryRequestPanel">
        <form id="recoveryRequestForm" class="recovery-form">
          <label>الاسم الكامل المسجل<input id="recoveryFullName" type="text" minlength="3" maxlength="80" required value="${esc(savedName)}" placeholder="اكتب الاسم كما سُجّل أول مرة"></label>
          <button class="primary wide" type="submit">إرسال طلب الاستعادة</button>
        </form>
        <div id="recoveryRequestResult"></div>
      </div>
      <div id="recoveryCheckPanel" class="hidden">
        <form id="recoveryCheckForm" class="recovery-form">
          <label>رمز المتابعة<input id="recoveryTokenInput" type="text" dir="ltr" autocomplete="off" required value="${esc(savedToken)}" placeholder="الصق رمز المتابعة هنا"></label>
          <button class="primary wide" type="submit">التحقق من حالة الطلب</button>
        </form>
        <div id="recoveryCheckResult"></div>
      </div>
      <div class="recovery-note">لا يوافق المدير على الطلب إلا بعد التحقق من صاحب الحساب. رمز المتابعة صالح لمدة ٤٨ ساعة.</div>
    </section>`);

  $('#recoveryRequestTab').onclick=()=>switchRecoveryPanel('request');
  $('#recoveryCheckTab').onclick=()=>switchRecoveryPanel('check');
  $('#recoveryRequestForm').onsubmit=submitAccessRecovery;
  $('#recoveryCheckForm').onsubmit=e=>{e.preventDefault();checkAccessRecovery($('#recoveryTokenInput').value.trim(),e.submitter)};
  if(savedToken)switchRecoveryPanel('check');
}
async function submitAccessRecovery(e){
  e.preventDefault();
  const button=e.submitter;
  const name=$('#recoveryFullName').value.trim();
  if(!state.backend?.createAccessRecovery){toast('حدّثي ملفات المنصة وشغّلي ملف الاستعادة في Supabase.','error');return}
  const token=generateRecoveryToken();
  setBusy(button,true,'جارٍ إرسال الطلب...');
  try{
    const result=await state.backend.createAccessRecovery(name,token);
    localStorage.setItem(RECOVERY_STORAGE_KEY,token);
    localStorage.setItem('bousla-recovery-name',name);
    const requestMessage=`طلب استعادة رقم الدخول لمنصة بوصلة رياضيات ١\nالاسم: ${name}\nرمز المتابعة: ${token}`;
    $('#recoveryRequestResult').innerHTML=`
      <div class="recovery-result success">
        <strong>تم إرسال الطلب بنجاح</strong>
        <p>احفظي رمز المتابعة التالي، ثم أرسليه إلى مدير المنصة بعد التواصل معه للتحقق من هويتك.</p>
        <code class="recovery-code" dir="ltr">${esc(token)}</code>
        <small>تنتهي صلاحية الطلب: ${esc(recoveryDate(result?.expires_at))}</small>
        <div class="recovery-actions">
          <button id="copyRecoveryCodeBtn" class="secondary" type="button">نسخ الرمز</button>
          <button id="copyRecoveryMessageBtn" class="secondary" type="button">نسخ رسالة الطلب</button>
          <button id="checkRecoveryNowBtn" class="primary" type="button">متابعة الطلب</button>
        </div>
      </div>`;
    $('#recoveryTokenInput').value=token;
    $('#copyRecoveryCodeBtn').onclick=()=>copyText(token);
    $('#copyRecoveryMessageBtn').onclick=()=>copyText(requestMessage);
    $('#checkRecoveryNowBtn').onclick=()=>{switchRecoveryPanel('check');checkAccessRecovery(token)};
  }catch(error){toast(translateError(error.message),'error')}
  finally{setBusy(button,false)}
}
async function checkAccessRecovery(token,button=null){
  const clean=String(token||'').trim();
  const resultBox=$('#recoveryCheckResult');
  if(!clean){toast('أدخلي رمز المتابعة.','error');return}
  if(!state.backend?.getAccessRecoveryResult){toast('حدّثي ملفات المنصة وشغّلي ملف الاستعادة في Supabase.','error');return}
  if(button)setBusy(button,true,'جارٍ التحقق...');
  resultBox.innerHTML='<div class="loading">جارٍ التحقق من الطلب...</div>';
  try{
    const result=await state.backend.getAccessRecoveryResult(clean);
    const status=result?.status||'invalid';
    if(status==='approved'&&result.membership_number){
      resultBox.innerHTML=`
        <div class="recovery-result approved">
          <strong>تمت الموافقة على طلبك</strong>
          <p>رقم الدخول المسجل باسم <b>${esc(result.full_name||'العضو')}</b> هو:</p>
          <code class="recovered-number" dir="ltr">${esc(result.membership_number)}</code>
          <div class="recovery-actions"><button id="copyRecoveredNumberBtn" class="primary" type="button">نسخ رقم الدخول</button><button id="goLoginBtn" class="secondary" type="button">العودة لتسجيل الدخول</button></div>
        </div>`;
      $('#copyRecoveredNumberBtn').onclick=()=>copyText(result.membership_number);
      $('#goLoginBtn').onclick=()=>{closeModal();switchAuth('login');$('#loginMemberNumber').value=result.membership_number};
      return;
    }
    const messages={
      open:['طلبك قيد المراجعة','تحققي من أن مدير المنصة استلم رمز المتابعة، ثم أعيدي الفحص لاحقًا.'],
      rejected:['تعذر اعتماد الطلب','راجعي مدير المنصة للتحقق من بيانات الحساب أو أرسلي طلبًا جديدًا.'],
      expired:['انتهت صلاحية الطلب','أرسلي طلب استعادة جديدًا؛ فالطلبات صالحة لمدة ٤٨ ساعة.'],
      invalid:['رمز المتابعة غير صحيح','تأكدي من نسخ الرمز كاملًا دون مسافات.']
    };
    const [title,message]=messages[status]||messages.invalid;
    resultBox.innerHTML=`<div class="recovery-result ${esc(status)}"><strong>${title}</strong><p>${message}</p>${result?.admin_note?`<div class="recovery-admin-note">ملاحظة المدير: ${esc(result.admin_note)}</div>`:''}${result?.expires_at?`<small>تنتهي الصلاحية: ${esc(recoveryDate(result.expires_at))}</small>`:''}</div>`;
  }catch(error){resultBox.innerHTML='';toast(translateError(error.message),'error')}
  finally{if(button)setBusy(button,false)}
}
function switchAuth(which){const login=which==='login';$('#loginTab').classList.toggle('active',login);$('#signupTab').classList.toggle('active',!login);$('#loginTab').setAttribute('aria-selected',login);$('#signupTab').setAttribute('aria-selected',!login);$('#loginForm').classList.toggle('hidden',!login);$('#signupForm').classList.toggle('hidden',login)}
async function handleLogin(e){
  e.preventDefault();
  const b=e.submitter||$('#loginForm button[type="submit"]');
  if(!state.backend){toast('الاتصال بقاعدة البيانات غير جاهز. حدّثي الصفحة بعد التأكد من ملف config.js.','error');return}
  setBusy(b,true,'جارٍ الدخول...');
  try{const result=await state.backend.signIn($('#loginName').value.trim(),$('#loginMemberNumber').value.trim());state.profile=result.profile;if(!state.session)await enterApp(result.session)}
  catch(error){toast(translateError(error.message),'error')}
  finally{setBusy(b,false)}
}
async function handleSignup(e){
  e.preventDefault();
  const b=e.submitter||$('#signupForm button[type="submit"]');
  if(!state.backend){toast('الاتصال بقاعدة البيانات غير جاهز. حدّثي الصفحة بعد التأكد من ملف config.js.','error');return}
  setBusy(b,true,'جارٍ الإنشاء...');
  try{const result=await state.backend.signUp($('#signupName').value.trim(),$('#signupMemberNumber').value.trim());toast(result.message,'success');if(result.session){state.profile=result.profile;if(!state.session)await enterApp(result.session)}else switchAuth('login')}
  catch(error){toast(translateError(error.message),'error')}
  finally{setBusy(b,false)}
}
function translateError(m){
  const s=String(m||'خطأ غير معروف');
  if(s.includes('Failed to fetch')||s.includes('NetworkError')||s.includes('انتهت مهلة'))return'تعذر الوصول إلى Supabase. تحققي من الإنترنت ثم أعيدي المحاولة.';
  if(s.includes('Invalid API key')||s.includes('No API key'))return'المفتاح العام في config.js غير صحيح أو غير مكتمل.';
  if(s.includes('Invalid login')||s.includes('Invalid login credentials'))return'الاسم أو رقم الدخول غير صحيح.';
  if(s.includes('already registered')||s.includes('User already registered')||s.includes('already been registered'))return'رقم الدخول مستخدم مسبقًا؛ اختاري رقمًا آخر.';
  if(s.includes('membership migration'))return'يلزم تشغيل ملف تحديث أرقام العضوية 04 في Supabase.';
  if(s.includes('Database error saving new user'))return'تعذر إنشاء الحساب داخل قاعدة البيانات. راجعي تشغيل ملف 04.';
  return s;
}
function showAuth(){state.session=null;state.profile=null;state.unsubscribe?.();state.unsubscribe=null;$('#appView').classList.add('hidden');$('#authView').classList.remove('hidden')}

async function enterApp(session){
  state.session=session;state.profile=state.profile||await state.backend.getProfile();state.skills=await state.backend.getSkills();
  $('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');
  $('#userName').textContent=state.profile?.full_name||'عضو';$('#userInitial').textContent=(state.profile?.full_name||'ع').trim()[0];$('#userRole').textContent=roleText[state.profile?.role]||'عضو';
  $$('.staff-only').forEach(el=>el.classList.toggle('hidden',!isStaff()));
  $$('.admin-only').forEach(el=>el.classList.toggle('hidden',state.profile?.role!=='admin'));
  buildMobileNav();populateSkillSelects();
  if(state.unsubscribe)state.unsubscribe();state.unsubscribe=state.backend.subscribeToLiveChanges(()=>{if(isStaff()&&state.page==='supervisor')loadSupervisor(false)});
  state.backend.touchProfile().catch(()=>{});
  navigate('home');
}
function buildMobileNav(){const buttons=$$('#mainNav button:not(.hidden)').map(b=>`<button data-page="${b.dataset.page}"><span>${b.querySelector('span').textContent}</span>${esc(b.textContent.trim().replace(b.querySelector('span').textContent,''))}</button>`).join('');$('#mobileNav').innerHTML=buttons;$('#mobileNav').style.gridTemplateColumns=`repeat(${Math.min(7,$$('#mainNav button:not(.hidden)').length)},1fr)`}
function populateSkillSelects(){const opts='<option value="">كل المجالات</option>'+state.skills.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('#practiceSkill').innerHTML=opts;$('#needSkill').innerHTML='<option value="">عام</option>'+state.skills.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
function navClick(e){const page=e.target.closest('[data-page]')?.dataset.page;if(page)navigate(page)}
function navigate(page){if((page==='supervisor'||page==='content')&&!isStaff())return;state.page=page;$$('.page').forEach(p=>p.classList.remove('active'));$(`#page${page[0].toUpperCase()+page.slice(1)}`).classList.add('active');$$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#pageTitle').textContent=titles[page][0];$('#pageSubtitle').textContent=titles[page][1];window.scrollTo({top:0,behavior:'smooth'});refreshPage(false)}
async function refreshPage(showMessage=false){try{if(state.page==='home')await loadHome();if(state.page==='practice')await loadPractice();if(state.page==='needs')await loadNeeds();if(state.page==='courses')await loadCourses();if(state.page==='supervisor')await loadSupervisor();if(state.page==='content')await loadContent();if(showMessage)toast('تم تحديث البيانات.','success')}catch(e){console.error(e);toast(e.message,'error')}}

async function loadHome(){
  $('#memberMetrics').innerHTML='<div class="loading">جارٍ تحميل المؤشرات...</div>';
  const [d,a]=await Promise.all([state.backend.getMyDashboard(),state.backend.getAnnouncements()]);state.dashboard=d;
  const readiness=Number(d.readiness||0);$('#readinessValue').textContent=arDigits(readiness)+'٪';$('#readinessRing').style.setProperty('--value',readiness);$('#modeBadge').textContent=state.mode==='live'?'بيانات حقيقية محفوظة':'معاينة تجريبية محلية';
  $('#welcomeTitle').textContent=`أهلًا ${state.profile.full_name}`;$('#welcomeText').textContent=isStaff()?'يمكنك متابعة احتياج الأعضاء أو الدخول إلى لوحة نبض الملتقى.':'ابدأ التشخيص أو واصل تدريبك؛ وستتغير التوصيات وفق نتائجك الفعلية.';
  const metrics=[['مؤشر الجاهزية',arDigits(readiness)+'٪',d.last_diagnostic_at?`آخر تشخيص: ${formatDate(d.last_diagnostic_at)}`:'لم يكتمل تشخيص بعد'],['مسائل محلولة',arDigits(d.practice_count||0),`دقة الإجابات ${arDigits(d.practice_accuracy||0)}٪`],['طلبات مفتوحة',arDigits(d.open_needs||0),'تظهر حالة المعالجة في قسم احتياجي'],['أكبر احتياج',d.weakest_skill||'لم يحدد','ابدأ بهذا المجال في خطتك']];
  $('#memberMetrics').innerHTML=metrics.map((m,i)=>`<article class="metric-card"><div class="metric-label"><span>${esc(m[0])}</span><span>${['◎','∑','✦','↗'][i]}</span></div><div class="metric-value">${esc(m[1])}</div><small>${esc(m[2])}</small></article>`).join('');
  const stats=d.skill_stats||[];$('#skillProgress').innerHTML=stats.length?stats.map(s=>progressRow(s.skill_name||skillName(s.skill_id),Number(s.score||0))).join(''):'<div class="empty-state">أكملي التشخيص لتظهر خريطة المهارات.</div>';
  const weak=d.weakest_skill||'التشخيص';$('#nextAction').innerHTML=`<div><div class="action-icon">${readiness?'◎':'⌁'}</div><h4>${readiness?`راجعي ${esc(weak)}`:'ابدئي بالتشخيص'}</h4><p>${readiness?'اختاري مسائل مركزة في أضعف مجال ثم أعيدي التشخيص بعد المراجعة.':'لن يطلب منك النظام دراسة كل شيء؛ سيحدد أولوياتك أولًا.'}</p><button class="primary" data-go="${readiness?'practice':'diagnostic'}" type="button">${readiness?'فتح بنك المسائل':'ابدأ التشخيص'}</button></div>`;
  $('#announcementsList').innerHTML=a.length?a.map(x=>`<article class="announcement"><h4>${esc(x.title)}</h4><p>${esc(x.body)}</p><time>${formatDate(x.created_at)}</time></article>`).join(''):'<div class="empty-state">لا توجد إعلانات حاليًا.</div>';
}
function progressRow(name,value){return`<div class="progress-item"><span>${esc(name)}</span><div class="progress-track"><i style="width:${Math.max(0,Math.min(100,value))}%;background:${percentColor(value)}"></i></div><strong>${arDigits(value)}٪</strong></div>`}

async function startDiagnostic(){const b=$('#startDiagnosticBtn');setBusy(b,true,'جارٍ إعداد الأسئلة...');try{const result=await state.backend.startDiagnostic();state.diagnostic={sessionId:result.session_id,questions:result.questions,index:0,selected:null,checked:false,questionStarted:Date.now(),started:Date.now(),timer:null};$('#diagnosticIntro').classList.add('hidden');$('#diagnosticResult').classList.add('hidden');$('#diagnosticRunner').classList.remove('hidden');startTimer();renderDiagnostic()}catch(e){toast(e.message,'error')}finally{setBusy(b,false)}}
function startTimer(){clearInterval(state.diagnostic?.timer);state.diagnostic.timer=setInterval(()=>{const secs=Math.floor((Date.now()-state.diagnostic.started)/1000);$('#diagnosticTimer').textContent=`${arDigits(String(Math.floor(secs/60)).padStart(2,'0'))}:${arDigits(String(secs%60).padStart(2,'0'))}`},1000)}
function renderDiagnostic(){const d=state.diagnostic,q=d.questions[d.index];d.selected=null;d.checked=false;d.questionStarted=Date.now();$('#diagnosticCounter').textContent=`السؤال ${arDigits(d.index+1)} من ${arDigits(d.questions.length)}`;$('#diagnosticSkill').textContent=q.skill_name;$('#diagnosticTrack').style.width=`${(d.index+1)*100/d.questions.length}%`;$('#diagnosticQuestion').textContent=q.question_text;$('#diagnosticOptions').innerHTML=q.options.map((o,i)=>`<button class="option" type="button" data-option="${i}"><span>${arDigits(i+1)}</span>${esc(o)}</button>`).join('');$('#diagnosticFeedback').className='feedback hidden';$('#diagnosticFeedback').innerHTML='';$('#diagnosticCheckBtn').classList.remove('hidden');$('#diagnosticNextBtn').classList.add('hidden');$('#diagnosticOptions').onclick=e=>{if(d.checked)return;const b=e.target.closest('[data-option]');if(!b)return;d.selected=Number(b.dataset.option);$$('.option',$('#diagnosticOptions')).forEach(x=>x.classList.toggle('selected',x===b))}}
async function checkDiagnostic(){const d=state.diagnostic;if(d.selected===null){toast('اختاري إجابة أولًا.','error');return}const b=$('#diagnosticCheckBtn');setBusy(b,true);try{const q=d.questions[d.index],seconds=Math.max(1,Math.round((Date.now()-d.questionStarted)/1000));const r=await state.backend.submitDiagnosticAnswer(d.sessionId,q.id,d.selected,seconds);d.checked=true;$$('.option',$('#diagnosticOptions')).forEach((el,i)=>{el.disabled=true;if(i===Number(r.correct_index))el.classList.add('correct');else if(i===d.selected)el.classList.add('wrong')});const f=$('#diagnosticFeedback');f.className=`feedback ${r.is_correct?'correct':'wrong'}`;f.innerHTML=`<strong>${r.is_correct?'إجابة صحيحة':'تحتاج مراجعة'}</strong><br>${esc(r.explanation||'')}<br><small><b>الفخ الشائع:</b> ${esc(r.trap||'—')}<br><b>طريقة سريعة:</b> ${esc(r.quick_method||'—')}</small>`;b.classList.add('hidden');$('#diagnosticNextBtn').classList.remove('hidden');$('#diagnosticNextBtn').textContent=d.index===d.questions.length-1?'عرض النتيجة':'التالي'}catch(e){toast(e.message,'error')}finally{setBusy(b,false)}}
async function nextDiagnostic(){const d=state.diagnostic;if(d.index<d.questions.length-1){d.index++;renderDiagnostic();return}clearInterval(d.timer);const b=$('#diagnosticNextBtn');setBusy(b,true,'جارٍ بناء التقرير...');try{const r=await state.backend.finishDiagnostic(d.sessionId);$('#diagnosticRunner').classList.add('hidden');const stats=r.skill_stats||[];$('#diagnosticResult').classList.remove('hidden');$('#diagnosticResult').innerHTML=`<div class="result-summary"><span class="badge">اكتمل التشخيص</span><div class="result-score">${arDigits(r.readiness)}٪</div><p>أجبت عن ${arDigits(r.correct)} من ${arDigits(r.total)} إجابات صحيحة.</p></div><div class="result-skills progress-list">${stats.map(s=>progressRow(s.skill_name||skillName(s.skill_id),Number(s.score))).join('')}</div><div class="actions" style="justify-content:center"><button class="primary" data-go="practice" type="button">ابدأ التدريب الموجّه</button><button id="restartDiag" class="secondary" type="button">إعادة التشخيص</button></div>`;$('#restartDiag').addEventListener('click',()=>{$('#diagnosticResult').classList.add('hidden');$('#diagnosticIntro').classList.remove('hidden')});await loadHome()}catch(e){toast(e.message,'error')}finally{setBusy(b,false)}}

async function loadPractice(){const list=$('#practiceList');list.innerHTML='<div class="loading">جارٍ تحميل الأسئلة...</div>';state.practice=await state.backend.getPracticeQuestions($('#practiceSkill').value,$('#practiceDifficulty').value);$('#questionCount').textContent=`${arDigits(state.practice.length)} مسألة`;list.innerHTML=state.practice.length?state.practice.map(q=>`<article class="question-card"><div class="q-meta"><span class="badge">${esc(q.skill_name)}</span><span class="difficulty">${esc(q.difficulty)}</span></div><h4>${esc(q.title)}</h4><p>${esc(q.question_text)}</p><button class="secondary" type="button" data-question-id="${q.id}">حل المسألة</button></article>`).join(''):'<div class="empty-state">لا توجد أسئلة بهذه التصفية.</div>'}
function openPractice(id){const q=state.practice.find(x=>String(x.id)===String(id));if(!q)return;const started=Date.now();openModal(q.title,`<div class="q-meta"><span class="badge">${esc(q.skill_name)}</span> <span class="difficulty">${esc(q.difficulty)}</span></div><p class="question-text">${esc(q.question_text)}</p><div id="practiceModalOptions" class="options">${q.options.map((o,i)=>`<button class="option" type="button" data-poption="${i}"><span>${arDigits(i+1)}</span>${esc(o)}</button>`).join('')}</div><div id="practiceModalFeedback" class="feedback hidden"></div><div class="quiz-actions"><button id="practiceSubmit" class="primary" type="button">تحقق من الإجابة</button></div>`);let selected=null;$('#practiceModalOptions').addEventListener('click',e=>{const b=e.target.closest('[data-poption]');if(!b||b.disabled)return;selected=Number(b.dataset.poption);$$('.option',$('#practiceModalOptions')).forEach(x=>x.classList.toggle('selected',x===b))});$('#practiceSubmit').addEventListener('click',async e=>{if(selected===null){toast('اختاري إجابة أولًا.','error');return}setBusy(e.currentTarget,true);try{const r=await state.backend.submitPracticeAnswer(q.id,selected,Math.round((Date.now()-started)/1000));$$('.option',$('#practiceModalOptions')).forEach((el,i)=>{el.disabled=true;if(i===Number(r.correct_index))el.classList.add('correct');else if(i===selected)el.classList.add('wrong')});const f=$('#practiceModalFeedback');f.className=`feedback ${r.is_correct?'correct':'wrong'}`;f.innerHTML=`<strong>${r.is_correct?'أحسنت':'راجعي الفكرة'}</strong><br>${esc(r.explanation||'')}<br><small><b>الفخ الشائع:</b> ${esc(r.trap||'—')}<br><b>طريقة الاختبار:</b> ${esc(r.quick_method||'—')}</small>`;e.currentTarget.remove();toast('حُفظت المحاولة في تقريرك.','success')}catch(err){toast(err.message,'error');setBusy(e.currentTarget,false)}})}

async function submitNeed(e){e.preventDefault();const b=e.submitter;setBusy(b,true,'جارٍ الإرسال...');try{await state.backend.createNeed({need_type:$('#needType').value,skill_id:$('#needSkill').value||null,details:$('#needDetails').value.trim()});e.target.reset();toast('وصل احتياجك إلى لوحة المشرف.','success');await loadNeeds()}catch(err){toast(err.message,'error')}finally{setBusy(b,false)}}
async function loadNeeds(){const rows=await state.backend.getMyNeeds();$('#myNeedsList').innerHTML=rows.length?rows.map(n=>`<article class="request-card"><header><h4>${esc(n.need_type)} — ${esc(n.skill_name||'عام')}</h4><span class="status ${n.status}">${statusText[n.status]||n.status}</span></header><p>${esc(n.details)}</p><small>${formatDate(n.created_at)}</small></article>`).join(''):'<div class="empty-state">لم ترسلي أي احتياج بعد.</div>'}
async function loadCourses(){const rows=await state.backend.getCourses();$('#coursesGrid').innerHTML=rows.length?rows.map((c,i)=>`<article class="course-card"><div class="course-cover" style="background:linear-gradient(135deg,${i%3===0?'var(--navy),var(--blue)':i%3===1?'#4d7d1d,var(--green)':'#a8580c,var(--orange)'})"><div><span class="badge" style="background:rgba(255,255,255,.15);color:#fff">${esc(c.level||'مسار')}</span><h4>${esc(c.trainer||c.provider||'')}</h4></div><span class="course-icon">${i%3===0?'π':i%3===1?'∑':'△'}</span></div><div class="course-body"><h4>${esc(c.title)}</h4><p>${esc(c.description)}</p><div class="course-links">${c.url?`<a class="primary-link" href="${esc(c.url)}" target="_blank" rel="noopener">فتح الدورة</a>`:''}${c.telegram_url?`<a href="${esc(c.telegram_url)}" target="_blank" rel="noopener">قناة المدرب</a>`:''}${!c.url&&!c.telegram_url?'<span class="badge">مسار داخلي مقترح</span>':''}</div></div></article>`).join(''):'<div class="empty-state">لا توجد دورات نشطة.</div>'}

async function loadSupervisor(){if(!isStaff())return;const [d,needs]=await Promise.all([state.backend.getSupervisorDashboard(),state.backend.getAllNeeds()]);state.allNeeds=needs;const metrics=[['الأعضاء',d.members_count,'حسابات مسجلة'],['الاحتياجات المفتوحة',d.open_needs,'تحتاج متابعة'],['محاولات ٧ أيام',d.attempts_7d,'تشخيص وتدريب'],['متوسط الجاهزية',`${d.average_readiness||0}٪`,'آخر النتائج']];$('#supervisorMetrics').innerHTML=metrics.map((m,i)=>`<article class="metric-card"><div class="metric-label"><span>${m[0]}</span><span>${['◎','✦','∑','↗'][i]}</span></div><div class="metric-value">${arDigits(m[1])}</div><small>${m[2]}</small></article>`).join('');const weak=d.weak_skills||[];$('#weakSkillsTable').innerHTML=`<table class="data-table"><thead><tr><th>المجال</th><th>معدل الخطأ</th><th>حجم البيانات</th><th>الإجراء</th></tr></thead><tbody>${weak.map(s=>`<tr><td>${esc(s.skill_name)}</td><td><span class="status ${s.error_rate>=60?'open':s.error_rate>=40?'in_progress':'resolved'}">${arDigits(s.error_rate)}٪</span></td><td>${arDigits(s.total||0)}</td><td>${s.error_rate>=60?'لقاء عاجل':s.error_rate>=40?'تدريب مركز':'تعزيز دوري'}</td></tr>`).join('')}</tbody></table>`;const summary=d.needs_summary||[],max=Math.max(1,...summary.map(x=>Number(x.count)));$('#needsSummary').innerHTML=summary.map(x=>`<div class="progress-item"><span>${esc(x.need_type)}</span><div class="progress-track"><i style="width:${x.count*100/max}%"></i></div><strong>${arDigits(x.count)}</strong></div>`).join('');renderSupervisorNeeds()}
function renderSupervisorNeeds(){$('#supervisorNeeds').innerHTML=`<table class="data-table"><thead><tr><th>العضو</th><th>الاحتياج</th><th>المجال</th><th>التفاصيل</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>${state.allNeeds.map(n=>`<tr><td>${esc(n.requester||'عضو')}</td><td>${esc(n.need_type)}</td><td>${esc(n.skill_name||'عام')}</td><td>${esc(n.details)}</td><td>${formatDate(n.created_at)}</td><td><select data-need-status="${n.id}"><option value="open" ${n.status==='open'?'selected':''}>جديد</option><option value="in_progress" ${n.status==='in_progress'?'selected':''}>قيد المعالجة</option><option value="resolved" ${n.status==='resolved'?'selected':''}>تمت المعالجة</option></select></td></tr>`).join('')}</tbody></table>`}
async function updateNeedStatus(id,status){try{await state.backend.updateNeedStatus(id,status);const n=state.allNeeds.find(x=>String(x.id)===String(id));if(n)n.status=status;toast('تم تحديث حالة الطلب.','success')}catch(e){toast(e.message,'error')}}
function exportNeedsCsv(){const headers=['العضو','نوع الاحتياج','المجال','التفاصيل','الحالة','التاريخ'];const lines=[headers,...state.allNeeds.map(n=>[n.requester,n.need_type,n.skill_name,n.details,statusText[n.status],n.created_at])].map(row=>row.map(x=>`"${String(x??'').replaceAll('"','""')}"`).join(','));const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`احتياجات_ملتقى_الرياضيات_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href)}

async function loadContent(){if(!isStaff())return;const tab=$('.content-tabs button.active')?.dataset.contentTab||'questions';if(tab==='questions')await loadAdminQuestions();if(tab==='courses')await loadAdminCourses();if(tab==='announcements')await loadAdminAnnouncements();if(tab==='members'&&state.profile?.role==='admin')await loadAdminMembers();if(tab==='recoveries'&&state.profile?.role==='admin')await loadAdminRecoveries()}
function switchContentTab(tab){$$('.content-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.contentTab===tab));$$('.content-tab').forEach(x=>x.classList.toggle('active',x.id===`content${tab[0].toUpperCase()+tab.slice(1)}`));if(tab==='questions')loadAdminQuestions();if(tab==='courses')loadAdminCourses();if(tab==='announcements')loadAdminAnnouncements();if(tab==='members'&&state.profile?.role==='admin')loadAdminMembers();if(tab==='recoveries'&&state.profile?.role==='admin')loadAdminRecoveries()}
async function loadAdminQuestions(){state.adminQuestions=await state.backend.adminListQuestions();$('#adminQuestions').innerHTML=`<table class="data-table"><thead><tr><th>العنوان</th><th>المجال</th><th>المستوى</th><th>تشخيصي</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${state.adminQuestions.map(q=>`<tr><td>${esc(q.title)}</td><td>${esc(q.skills?.name||skillName(q.skill_id))}</td><td>${esc(q.difficulty)}</td><td>${q.is_diagnostic?'نعم':'لا'}</td><td>${q.active===false?'متوقف':'نشط'}</td><td><div class="table-actions"><button class="edit" data-edit-question="${q.id}">تعديل</button><button class="toggle" data-toggle-question="${q.id}" data-active="${q.active!==false}">${q.active===false?'تفعيل':'إيقاف'}</button></div></td></tr>`).join('')}</tbody></table>`}
function adminQuestionAction(e){const edit=e.target.dataset.editQuestion,toggle=e.target.dataset.toggleQuestion;if(edit)questionForm(state.adminQuestions.find(q=>String(q.id)===String(edit)));if(toggle)toggleQuestion(toggle,e.target.dataset.active==='true')}
async function toggleQuestion(id,current){try{await state.backend.toggleQuestion(id,!current);toast('تم تحديث السؤال.','success');loadAdminQuestions()}catch(e){toast(e.message,'error')}}
function questionForm(q=null){const options=q?.options||['','','',''];openModal(q?'تعديل السؤال':'إضافة سؤال',`<form id="questionAdminForm" class="modal-form"><label>العنوان<input name="title" required value="${esc(q?.title||'')}"></label><label>المجال<select name="skill_id" required>${state.skills.map(s=>`<option value="${s.id}" ${q?.skill_id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>المستوى<select name="difficulty"><option ${q?.difficulty==='متوسط'?'selected':''}>متوسط</option><option ${q?.difficulty==='متقدم'?'selected':''}>متقدم</option></select></label><label>الأولوية<input name="priority" type="number" min="1" max="100" value="${q?.priority||50}"></label><label class="full">نص السؤال<textarea name="question_text" rows="3" required>${esc(q?.question_text||'')}</textarea></label><label class="full">الخيارات — كل خيار في سطر<textarea name="options" rows="5" required>${esc(options.join('\n'))}</textarea></label><label>رقم الإجابة الصحيحة (١–٤)<input name="correct_index" type="number" min="1" max="4" value="${Number(q?.correct_index??0)+1}" required></label><label>نوع السؤال<select name="is_diagnostic"><option value="false" ${!q?.is_diagnostic?'selected':''}>تدريبي</option><option value="true" ${q?.is_diagnostic?'selected':''}>تشخيصي</option></select></label><label class="full">الشرح<textarea name="explanation" rows="3" required>${esc(q?.explanation||'')}</textarea></label><label class="full">الفخ الشائع<input name="trap" value="${esc(q?.trap||'')}"></label><label class="full">الطريقة السريعة<input name="quick_method" value="${esc(q?.quick_method||'')}"></label><div class="modal-actions"><button class="ghost" type="button" id="cancelModal">إلغاء</button><button class="primary" type="submit">حفظ</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#questionAdminForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.target),opts=String(fd.get('options')).split('\n').map(x=>x.trim()).filter(Boolean);if(opts.length<2){toast('أضيفي خيارين على الأقل.','error');return}setBusy(b,true);try{await state.backend.saveQuestion({title:fd.get('title'),skill_id:fd.get('skill_id'),difficulty:fd.get('difficulty'),priority:Number(fd.get('priority')),question_text:fd.get('question_text'),options:opts,correct_index:Number(fd.get('correct_index'))-1,is_diagnostic:fd.get('is_diagnostic')==='true',explanation:fd.get('explanation'),trap:fd.get('trap'),quick_method:fd.get('quick_method'),active:q?.active!==false},q?.id);closeModal();toast('تم حفظ السؤال.','success');loadAdminQuestions()}catch(err){toast(err.message,'error');setBusy(b,false)}}}
async function loadAdminCourses(){state.adminCourses=await state.backend.adminListCourses();$('#adminCourses').innerHTML=`<table class="data-table"><thead><tr><th>الدورة</th><th>المدرب/المصدر</th><th>المجال</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${state.adminCourses.map(c=>`<tr><td>${esc(c.title)}</td><td>${esc(c.trainer||c.provider||'')}</td><td>${esc(c.skills?.name||skillName(c.skill_id))}</td><td>${c.active===false?'متوقفة':'نشطة'}</td><td><div class="table-actions"><button class="edit" data-edit-course="${c.id}">تعديل</button><button class="toggle" data-toggle-course="${c.id}" data-active="${c.active!==false}">${c.active===false?'تفعيل':'إيقاف'}</button></div></td></tr>`).join('')}</tbody></table>`}
function adminCourseAction(e){const edit=e.target.dataset.editCourse,toggle=e.target.dataset.toggleCourse;if(edit)courseForm(state.adminCourses.find(c=>String(c.id)===String(edit)));if(toggle)state.backend.toggleCourse(toggle,e.target.dataset.active!=='true').then(()=>{toast('تم تحديث الدورة.','success');loadAdminCourses()}).catch(x=>toast(x.message,'error'))}
function courseForm(c=null){openModal(c?'تعديل الدورة':'إضافة دورة',`<form id="courseAdminForm" class="modal-form"><label class="full">اسم الدورة<input name="title" required value="${esc(c?.title||'')}"></label><label>المدرب<input name="trainer" value="${esc(c?.trainer||'')}"></label><label>المصدر<input name="provider" value="${esc(c?.provider||'')}"></label><label>المجال<select name="skill_id"><option value="">عام</option>${state.skills.map(s=>`<option value="${s.id}" ${c?.skill_id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>المستوى<input name="level" value="${esc(c?.level||'')}"></label><label class="full">الوصف<textarea name="description" rows="3" required>${esc(c?.description||'')}</textarea></label><label class="full">رابط الدورة<input name="url" type="url" value="${esc(c?.url||'')}"></label><label class="full">رابط القناة<input name="telegram_url" type="url" value="${esc(c?.telegram_url||'')}"></label><label>مميزة<select name="featured"><option value="false" ${!c?.featured?'selected':''}>لا</option><option value="true" ${c?.featured?'selected':''}>نعم</option></select></label><div class="modal-actions"><button class="ghost" type="button" id="cancelModal">إلغاء</button><button class="primary" type="submit">حفظ</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#courseAdminForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.target);setBusy(b,true);try{await state.backend.saveCourse(Object.fromEntries([...fd].map(([k,v])=>[k,k==='featured'?v==='true':v])),c?.id);closeModal();toast('تم حفظ الدورة.','success');loadAdminCourses()}catch(err){toast(err.message,'error');setBusy(b,false)}}}
async function loadAdminAnnouncements(){state.adminAnnouncements=await state.backend.adminListAnnouncements();$('#adminAnnouncements').innerHTML=`<table class="data-table"><thead><tr><th>العنوان</th><th>النص</th><th>التاريخ</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${state.adminAnnouncements.map(a=>`<tr><td>${esc(a.title)}</td><td>${esc(a.body)}</td><td>${formatDate(a.created_at)}</td><td>${a.active===false?'مخفي':'ظاهر'}</td><td><div class="table-actions"><button class="edit" data-edit-announcement="${a.id}">تعديل</button><button class="toggle" data-toggle-announcement="${a.id}" data-active="${a.active!==false}">${a.active===false?'إظهار':'إخفاء'}</button></div></td></tr>`).join('')}</tbody></table>`}
function adminAnnouncementAction(e){const edit=e.target.dataset.editAnnouncement,toggle=e.target.dataset.toggleAnnouncement;if(edit)announcementForm(state.adminAnnouncements.find(a=>String(a.id)===String(edit)));if(toggle)state.backend.toggleAnnouncement(toggle,e.target.dataset.active!=='true').then(()=>{toast('تم تحديث الإعلان.','success');loadAdminAnnouncements()}).catch(x=>toast(x.message,'error'))}
function announcementForm(a=null){openModal(a?'تعديل الإعلان':'إعلان جديد',`<form id="announcementAdminForm" class="modal-form"><label class="full">العنوان<input name="title" required value="${esc(a?.title||'')}"></label><label class="full">نص الإعلان<textarea name="body" rows="5" required>${esc(a?.body||'')}</textarea></label><div class="modal-actions"><button class="ghost" type="button" id="cancelModal">إلغاء</button><button class="primary" type="submit">حفظ</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#announcementAdminForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter,fd=new FormData(e.target);setBusy(b,true);try{await state.backend.saveAnnouncement({title:fd.get('title'),body:fd.get('body'),active:a?.active!==false},a?.id);closeModal();toast('تم حفظ الإعلان.','success');loadAdminAnnouncements()}catch(err){toast(err.message,'error');setBusy(b,false)}}}


async function loadAdminMembers(){
  if(state.profile?.role!=='admin')return;
  state.adminMembers=await state.backend.adminListProfiles();
  $('#adminMembers').innerHTML=`<table class="data-table"><thead><tr><th>الاسم</th><th>رقم الدخول</th><th>الدور</th><th>آخر نشاط</th><th>تاريخ التسجيل</th></tr></thead><tbody>${state.adminMembers.map(p=>`<tr><td>${esc(p.full_name)}</td><td>${esc(p.membership_number||'—')}</td><td><select data-profile-role="${p.id}" ${p.id===state.profile.id?'disabled title="لا يمكن تعديل دور حسابك الحالي"':''}><option value="member" ${p.role==='member'?'selected':''}>عضو</option><option value="supervisor" ${p.role==='supervisor'?'selected':''}>مشرف</option><option value="admin" ${p.role==='admin'?'selected':''}>مدير</option></select></td><td>${formatDate(p.last_seen_at)}</td><td>${formatDate(p.created_at)}</td></tr>`).join('')}</tbody></table>`;
}
async function updateMemberRole(id,role){
  try{await state.backend.updateProfileRole(id,role);toast('تم تحديث صلاحية الحساب.','success');await loadAdminMembers()}catch(e){toast(e.message,'error')}
}

const recoveryAdminStatus={open:'بانتظار المراجعة',approved:'تمت الموافقة',rejected:'مرفوض',expired:'منتهي'};
async function loadAdminRecoveries(){
  if(state.profile?.role!=='admin')return;
  const container=$('#adminRecoveries');
  container.innerHTML='<div class="loading">جارٍ تحميل طلبات الاستعادة...</div>';
  try{
    const [requests,members]=await Promise.all([state.backend.adminListAccessRecoveries(),state.backend.adminListProfiles()]);
    state.adminRecoveries=Array.isArray(requests)?requests:[];
    state.adminMembers=Array.isArray(members)?members:[];
    if(!state.adminRecoveries.length){container.innerHTML='<div class="empty-state">لا توجد طلبات استعادة حتى الآن.</div>';return}
    container.innerHTML=`<table class="data-table recovery-admin-table"><thead><tr><th>الاسم المطلوب</th><th>وقت الطلب</th><th>الحالة</th><th>الحساب المطابق</th><th>الإجراء</th></tr></thead><tbody>${state.adminRecoveries.map(request=>{
      const open=request.status==='open';
      const options=state.adminMembers.filter(member=>member.active!==false).map(member=>`<option value="${member.id}" ${request.profile_id===member.id?'selected':''}>${esc(member.full_name)} — ${esc(member.membership_number||'دون رقم')}</option>`).join('');
      return `<tr data-recovery-row="${request.id}"><td><strong>${esc(request.requested_name)}</strong>${request.admin_note?`<small class="table-note">${esc(request.admin_note)}</small>`:''}</td><td>${formatDate(request.created_at)}<small class="table-note">ينتهي: ${formatDate(request.expires_at)}</small></td><td><span class="status recovery-${esc(request.status)}">${esc(recoveryAdminStatus[request.status]||request.status)}</span></td><td>${open?`<select data-recovery-profile><option value="">اختر حساب العضو</option>${options}</select>`:`${esc(request.matched_name||'—')}<small class="table-note">${esc(request.membership_number||'')}</small>`}</td><td>${open?`<div class="table-actions"><button class="edit" data-approve-recovery="${request.id}">موافقة</button><button class="toggle" data-reject-recovery="${request.id}">رفض</button></div>`:'—'}</td></tr>`;
    }).join('')}</tbody></table>`;
  }catch(error){container.innerHTML='<div class="empty-state">تعذر تحميل طلبات الاستعادة.</div>';toast(translateError(error.message),'error')}
}
async function adminRecoveryAction(e){
  const approve=e.target.dataset.approveRecovery;
  const reject=e.target.dataset.rejectRecovery;
  const requestId=approve||reject;
  if(!requestId)return;
  const row=e.target.closest('[data-recovery-row]');
  const profileId=row?.querySelector('[data-recovery-profile]')?.value||null;
  if(approve&&!profileId){toast('اختاري حساب العضو بعد التحقق من هويته.','error');return}
  const action=approve?'approved':'rejected';
  const confirmation=approve?'هل تم التحقق من هوية العضو وتريدين إظهار رقم دخوله له؟':'هل تريدين رفض طلب الاستعادة؟';
  if(!confirm(confirmation))return;
  setBusy(e.target,true,approve?'جارٍ الاعتماد...':'جارٍ الرفض...');
  try{await state.backend.resolveAccessRecovery(requestId,profileId,action);toast(approve?'تم اعتماد طلب الاستعادة.':'تم رفض الطلب.','success');await loadAdminRecoveries()}
  catch(error){toast(translateError(error.message),'error');setBusy(e.target,false)}
}

init();
