const toLatinDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const normalizeMemberNumber=value=>toLatinDigits(value).replace(/\D/g,'');
const normalizeName=value=>String(value??'').trim().replace(/[ـًٌٍَُِّْ]/g,'').replace(/\s+/g,' ').toLowerCase();
const validateIdentity=(name,memberNumber)=>{
  const cleanName=String(name??'').trim().replace(/\s+/g,' '),number=normalizeMemberNumber(memberNumber);
  if(cleanName.length<3)throw new Error('اكتب الاسم الكامل كما سُجل أول مرة.');
  if(!/^\d{5,12}$/.test(number))throw new Error('رقم الدخول يجب أن يتكون من ٥ إلى ١٢ رقمًا.');
  return{name:cleanName,number};
};
const authEmail=number=>`m${number}@members.bousla.app`;
const authPassword=number=>`Bousla-Math1-${number}-Access!`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class SupabaseBackend{
  constructor(config){
    this.mode='live';
    this.url=String(config.SUPABASE_URL||'').replace(/\/$/,'');
    this.key=String(config.SUPABASE_ANON_KEY||'');
    this.storageKey='bousla-supabase-session-v2';
    this.session=this.loadSession();
    this.listeners=new Set();
    if(!this.url||!this.key)throw new Error('بيانات ربط Supabase ناقصة.');
  }

  loadSession(){
    try{return JSON.parse(localStorage.getItem(this.storageKey)||'null')}catch{return null}
  }
  saveSession(session){
    this.session=session||null;
    if(session)localStorage.setItem(this.storageKey,JSON.stringify(session));
    else localStorage.removeItem(this.storageKey);
  }
  emit(event,session=this.session){for(const cb of this.listeners){try{cb(event,session)}catch(error){console.error(error)}}}
  onAuthStateChange(cb){this.listeners.add(cb);return()=>this.listeners.delete(cb)}

  async fetchJson(url,options={},timeoutMs=18000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{...options,signal:controller.signal});
      const text=await response.text();
      let payload=null;
      if(text){try{payload=JSON.parse(text)}catch{payload=text}}
      if(!response.ok){
        const message=payload?.msg||payload?.message||payload?.error_description||payload?.error||`خطأ اتصال (${response.status})`;
        const error=new Error(message);error.status=response.status;error.payload=payload;throw error;
      }
      return payload;
    }catch(error){
      if(error.name==='AbortError')throw new Error('انتهت مهلة الاتصال بقاعدة البيانات.');
      throw error;
    }finally{clearTimeout(timer)}
  }

  authHeaders(authenticated=false){
    const token=authenticated?this.session?.access_token:this.key;
    return{'apikey':this.key,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'};
  }
  normalizeSession(payload){
    if(!payload)return null;
    if(payload.session)return payload.session;
    if(payload.access_token)return{access_token:payload.access_token,refresh_token:payload.refresh_token,expires_in:payload.expires_in,expires_at:payload.expires_at,token_type:payload.token_type||'bearer',user:payload.user};
    return null;
  }
  async refreshSession(){
    const refreshToken=this.session?.refresh_token;
    if(!refreshToken)throw new Error('انتهت الجلسة. سجلي الدخول مرة أخرى.');
    const payload=await this.fetchJson(`${this.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:this.authHeaders(false),body:JSON.stringify({refresh_token:refreshToken})});
    const session=this.normalizeSession(payload);this.saveSession(session);return session;
  }
  async authRequest(path,body){
    return this.fetchJson(`${this.url}/auth/v1/${path}`,{method:'POST',headers:this.authHeaders(false),body:JSON.stringify(body)});
  }
  async getAuthUser(retry=true){
    if(!this.session?.access_token)return null;
    try{return await this.fetchJson(`${this.url}/auth/v1/user`,{headers:this.authHeaders(true)})}
    catch(error){if(retry&&error.status===401){await this.refreshSession();return this.getAuthUser(false)}throw error}
  }

  async initialize(){
    if(!this.session)return{session:null,profile:null};
    try{
      const user=await this.getAuthUser();
      if(!user){this.saveSession(null);return{session:null,profile:null}}
      this.session.user=user;this.saveSession(this.session);
      return{session:this.session,profile:await this.getProfile()};
    }catch(error){console.warn(error);this.saveSession(null);return{session:null,profile:null}}
  }
  async signUp(name,memberNumber){
    const identity=validateIdentity(name,memberNumber);
    const payload=await this.authRequest('signup',{email:authEmail(identity.number),password:authPassword(identity.number),data:{full_name:identity.name,membership_number:identity.number}});
    const session=this.normalizeSession(payload);
    if(!session)throw new Error('لم تُنشأ جلسة دخول. تأكدي أن Confirm email متوقف في Supabase.');
    this.saveSession(session);
    let profile=null;
    for(let i=0;i<8;i++){
      try{profile=await this.getProfile();if(profile)break}catch(error){if(i===7)throw error;await delay(300)}
    }
    if(!profile?.membership_number){await this.signOut();throw new Error('membership migration required')}
    return{session:this.session,profile,message:'تم إنشاء حسابك وحفظ رقم الدخول بنجاح.'};
  }
  async signIn(name,memberNumber){
    const identity=validateIdentity(name,memberNumber);
    const payload=await this.authRequest('token?grant_type=password',{email:authEmail(identity.number),password:authPassword(identity.number)});
    const session=this.normalizeSession(payload);if(!session)throw new Error('تعذر إنشاء جلسة الدخول.');
    this.saveSession(session);
    const profile=await this.getProfile();
    if(!profile?.membership_number){await this.signOut();throw new Error('membership migration required')}
    if(normalizeName(profile.full_name)!==normalizeName(identity.name)){await this.signOut();throw new Error('الاسم أو رقم الدخول غير صحيح.')}
    return{session:this.session,profile};
  }
  async signOut(){
    if(this.session?.access_token){try{await this.fetchJson(`${this.url}/auth/v1/logout`,{method:'POST',headers:this.authHeaders(true)})}catch(error){console.warn(error)}}
    this.saveSession(null);this.emit('SIGNED_OUT',null);return true;
  }

  async rest(path,{method='GET',body,headers={},retry=true}={}){
    if(!this.session?.access_token)throw new Error('انتهت الجلسة. سجلي الدخول مرة أخرى.');
    try{
      return await this.fetchJson(`${this.url}/rest/v1/${path}`,{method,headers:{...this.authHeaders(true),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    }catch(error){if(retry&&error.status===401){await this.refreshSession();return this.rest(path,{method,body,headers,retry:false})}throw error}
  }
  async rpc(name,args={}){return this.rest(`rpc/${name}`,{method:'POST',body:args})}
  first(data){return Array.isArray(data)?data[0]||null:data}

  async getProfile(){
    const user=await this.getAuthUser();if(!user)return null;
    return this.first(await this.rest(`profiles?select=*&id=eq.${encodeURIComponent(user.id)}&limit=1`));
  }
  async getSkills(){const data=await this.rest('skills?select=id,name,sort_order&order=sort_order.asc');return(data||[]).map(x=>({id:x.id,name:x.name,sort:x.sort_order}))}
  async getAnnouncements(){return this.rest('announcements?select=*&active=eq.true&order=created_at.desc&limit=10')}
  async getMyDashboard(){return this.rpc('get_my_dashboard')}
  async startDiagnostic(){return this.rpc('start_diagnostic')}
  async submitDiagnosticAnswer(sessionId,questionId,selectedIndex,responseSeconds){return this.rpc('submit_diagnostic_answer',{p_session_id:sessionId,p_question_id:questionId,p_selected_index:selectedIndex,p_response_seconds:responseSeconds})}
  async finishDiagnostic(sessionId){return this.rpc('finish_diagnostic',{p_session_id:sessionId})}
  async getPracticeQuestions(skillId='',difficulty=''){return this.rpc('get_practice_questions',{p_skill_id:skillId||null,p_difficulty:difficulty||null,p_limit:100})}
  async submitPracticeAnswer(questionId,selectedIndex,responseSeconds){return this.rpc('submit_practice_answer',{p_question_id:questionId,p_selected_index:selectedIndex,p_response_seconds:responseSeconds})}
  async createNeed(payload){const user=await this.getAuthUser();const rows=await this.rest('need_requests?select=*,skills(name)',{method:'POST',headers:{Prefer:'return=representation'},body:{user_id:user.id,need_type:payload.need_type,skill_id:payload.skill_id||null,details:payload.details}});const row=this.first(rows);return{...row,skill_name:row?.skills?.name||'عام'}}
  async getMyNeeds(){const rows=await this.rest('need_requests?select=*,skills(name)&order=created_at.desc');return(rows||[]).map(r=>({...r,skill_name:r.skills?.name||'عام'}))}
  async getCourses(){return this.rest('courses?select=*,skills(name)&active=eq.true&order=featured.desc,created_at.desc')}
  async getSupervisorDashboard(){return this.rpc('get_supervisor_dashboard')}
  async getAllNeeds(){const rows=await this.rest('need_requests?select=*,skills(name),profiles(full_name)&order=created_at.desc&limit=500');return(rows||[]).map(r=>({...r,skill_name:r.skills?.name||'عام',requester:r.profiles?.full_name||'عضو'}))}
  async updateNeedStatus(id,status){return this.first(await this.rest(`need_requests?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:{status,updated_at:new Date().toISOString()}}))}
  async adminListQuestions(){return this.rest('questions?select=*,skills(name)&order=created_at.desc')}
  async saveQuestion(payload,id=null){const row={...payload,options:Array.isArray(payload.options)?payload.options:[],skill_id:payload.skill_id,correct_index:Number(payload.correct_index),priority:Number(payload.priority||50),is_diagnostic:Boolean(payload.is_diagnostic),active:payload.active!==false};if(id)return this.rest(`questions?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:row});return this.rest('questions',{method:'POST',body:row})}
  async toggleQuestion(id,active){return this.rest(`questions?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{active}})}
  async adminListCourses(){return this.rest('courses?select=*,skills(name)&order=created_at.desc')}
  async saveCourse(payload,id=null){const row={...payload,skill_id:payload.skill_id||null,featured:Boolean(payload.featured),active:payload.active!==false};if(id)return this.rest(`courses?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:row});return this.rest('courses',{method:'POST',body:row})}
  async toggleCourse(id,active){return this.rest(`courses?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{active}})}
  async adminListAnnouncements(){return this.rest('announcements?select=*&order=created_at.desc')}
  async adminListProfiles(){return this.rest('profiles?select=id,full_name,membership_number,role,active,last_seen_at,created_at&order=created_at.desc')}
  async updateProfileRole(id,role){return this.first(await this.rest(`profiles?id=eq.${encodeURIComponent(id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:{role}}))}
  async saveAnnouncement(payload,id=null){const row={...payload,active:payload.active!==false};if(id)return this.rest(`announcements?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:row});return this.rest('announcements',{method:'POST',body:row})}
  async toggleAnnouncement(id,active){return this.rest(`announcements?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{active}})}
  subscribeToLiveChanges(callback){const timer=setInterval(()=>{try{callback()}catch{}},60000);return()=>clearInterval(timer)}
  async touchProfile(){try{await this.rpc('touch_profile')}catch(error){console.warn(error.message)}}
}
