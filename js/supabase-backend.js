import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.9/+esm';

const unwrap=(data,error)=>{if(error)throw new Error(error.message||'حدث خطأ في قاعدة البيانات.');return data};

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

export class SupabaseBackend{
  constructor(config){
    this.mode='live';
    this.client=createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  }
  async initialize(){const {data:{session},error}=await this.client.auth.getSession();if(error)throw error;return{session,profile:session?await this.getProfile():null}}
  onAuthStateChange(cb){const {data}=this.client.auth.onAuthStateChange((event,session)=>cb(event,session));return()=>data.subscription.unsubscribe()}
  async signIn(name,memberNumber){
    const identity=validateIdentity(name,memberNumber);
    const {data,error}=await this.client.auth.signInWithPassword({email:authEmail(identity.number),password:authPassword(identity.number)});
    unwrap(data,error);
    const profile=await this.getProfile();
    if(!profile?.membership_number){await this.client.auth.signOut();throw new Error('membership migration required');}
    if(normalizeName(profile.full_name)!==normalizeName(identity.name)){await this.client.auth.signOut();throw new Error('الاسم أو رقم الدخول غير صحيح.');}
    return{session:data.session,profile};
  }
  async signUp(name,memberNumber){
    const identity=validateIdentity(name,memberNumber);
    const {data,error}=await this.client.auth.signUp({email:authEmail(identity.number),password:authPassword(identity.number),options:{data:{full_name:identity.name,membership_number:identity.number}}});
    unwrap(data,error);
    const profile=data.session?await this.getProfile():null;
    if(data.session&&!profile?.membership_number){await this.client.auth.signOut();throw new Error('membership migration required');}
    return{session:data.session,profile,message:'تم إنشاء حسابك وحفظ رقم الدخول بنجاح.'};
  }
  async signOut(){const {error}=await this.client.auth.signOut();unwrap(true,error)}
  async getProfile(){const {data:{user},error:uerr}=await this.client.auth.getUser();unwrap(user,uerr);if(!user)return null;const {data,error}=await this.client.from('profiles').select('*').eq('id',user.id).single();return unwrap(data,error)}
  async getSkills(){const {data,error}=await this.client.from('skills').select('id,name,sort_order').order('sort_order');return unwrap(data,error).map(x=>({id:x.id,name:x.name,sort:x.sort_order}))}
  async getAnnouncements(){const {data,error}=await this.client.from('announcements').select('*').eq('active',true).order('created_at',{ascending:false}).limit(10);return unwrap(data,error)}
  async getMyDashboard(){const {data,error}=await this.client.rpc('get_my_dashboard');return unwrap(data,error)}
  async startDiagnostic(){const {data,error}=await this.client.rpc('start_diagnostic');return unwrap(data,error)}
  async submitDiagnosticAnswer(sessionId,questionId,selectedIndex,responseSeconds){const {data,error}=await this.client.rpc('submit_diagnostic_answer',{p_session_id:sessionId,p_question_id:questionId,p_selected_index:selectedIndex,p_response_seconds:responseSeconds});return unwrap(data,error)}
  async finishDiagnostic(sessionId){const {data,error}=await this.client.rpc('finish_diagnostic',{p_session_id:sessionId});return unwrap(data,error)}
  async getPracticeQuestions(skillId='',difficulty=''){const {data,error}=await this.client.rpc('get_practice_questions',{p_skill_id:skillId||null,p_difficulty:difficulty||null,p_limit:100});return unwrap(data,error)}
  async submitPracticeAnswer(questionId,selectedIndex,responseSeconds){const {data,error}=await this.client.rpc('submit_practice_answer',{p_question_id:questionId,p_selected_index:selectedIndex,p_response_seconds:responseSeconds});return unwrap(data,error)}
  async createNeed(payload){const {data:{user}}=await this.client.auth.getUser();const {data,error}=await this.client.from('need_requests').insert({user_id:user.id,need_type:payload.need_type,skill_id:payload.skill_id||null,details:payload.details}).select('*,skills(name)').single();const row=unwrap(data,error);return{...row,skill_name:row.skills?.name||'عام'}}
  async getMyNeeds(){const {data,error}=await this.client.from('need_requests').select('*,skills(name)').order('created_at',{ascending:false});return unwrap(data,error).map(r=>({...r,skill_name:r.skills?.name||'عام'}))}
  async getCourses(){const {data,error}=await this.client.from('courses').select('*,skills(name)').eq('active',true).order('featured',{ascending:false}).order('created_at',{ascending:false});return unwrap(data,error)}
  async getSupervisorDashboard(){const {data,error}=await this.client.rpc('get_supervisor_dashboard');return unwrap(data,error)}
  async getAllNeeds(){const {data,error}=await this.client.from('need_requests').select('*,skills(name),profiles(full_name)').order('created_at',{ascending:false}).limit(500);return unwrap(data,error).map(r=>({...r,skill_name:r.skills?.name||'عام',requester:r.profiles?.full_name||'عضو'}))}
  async updateNeedStatus(id,status){const {data,error}=await this.client.from('need_requests').update({status,updated_at:new Date().toISOString()}).eq('id',id).select().single();return unwrap(data,error)}
  async adminListQuestions(){const {data,error}=await this.client.from('questions').select('*,skills(name)').order('created_at',{ascending:false});return unwrap(data,error)}
  async saveQuestion(payload,id=null){const row={...payload,options:Array.isArray(payload.options)?payload.options:[],skill_id:payload.skill_id,correct_index:Number(payload.correct_index),priority:Number(payload.priority||50),is_diagnostic:Boolean(payload.is_diagnostic),active:payload.active!==false};if(id){const {error}=await this.client.from('questions').update(row).eq('id',id);return unwrap(true,error)}const {error}=await this.client.from('questions').insert(row);return unwrap(true,error)}
  async toggleQuestion(id,active){const {error}=await this.client.from('questions').update({active}).eq('id',id);return unwrap(true,error)}
  async adminListCourses(){const {data,error}=await this.client.from('courses').select('*,skills(name)').order('created_at',{ascending:false});return unwrap(data,error)}
  async saveCourse(payload,id=null){const row={...payload,skill_id:payload.skill_id||null,featured:Boolean(payload.featured),active:payload.active!==false};if(id){const {error}=await this.client.from('courses').update(row).eq('id',id);return unwrap(true,error)}const {error}=await this.client.from('courses').insert(row);return unwrap(true,error)}
  async toggleCourse(id,active){const {error}=await this.client.from('courses').update({active}).eq('id',id);return unwrap(true,error)}
  async adminListAnnouncements(){const {data,error}=await this.client.from('announcements').select('*').order('created_at',{ascending:false});return unwrap(data,error)}
  async adminListProfiles(){const {data,error}=await this.client.from('profiles').select('id,full_name,membership_number,role,active,last_seen_at,created_at').order('created_at',{ascending:false});return unwrap(data,error)}
  async updateProfileRole(id,role){const {data,error}=await this.client.from('profiles').update({role}).eq('id',id).select().single();return unwrap(data,error)}
  async saveAnnouncement(payload,id=null){const row={...payload,active:payload.active!==false};if(id){const {error}=await this.client.from('announcements').update(row).eq('id',id);return unwrap(true,error)}const {error}=await this.client.from('announcements').insert(row);return unwrap(true,error)}
  async toggleAnnouncement(id,active){const {error}=await this.client.from('announcements').update({active}).eq('id',id);return unwrap(true,error)}
  subscribeToLiveChanges(callback){const channel=this.client.channel('bousla-live').on('postgres_changes',{event:'*',schema:'public',table:'need_requests'},callback).on('postgres_changes',{event:'INSERT',schema:'public',table:'practice_attempts'},callback).subscribe();return()=>this.client.removeChannel(channel)}
  async touchProfile(){const {error}=await this.client.rpc('touch_profile');if(error)console.warn(error.message)}
}
