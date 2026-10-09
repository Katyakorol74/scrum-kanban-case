import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl || 'http://127.0.0.1', serviceKey || 'missing-service-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

let activeStore = null;
let requestQueue = Promise.resolve();

function appRead_(key) {
  return activeStore ? (activeStore.get(String(key)) ?? null) : null;
}
function appWrite_(key, value, allowOverwrite = true) {
  if (!activeStore) throw new Error('Хранилище не инициализировано.');
  const k = String(key);
  if (activeStore.has(k) && allowOverwrite === false) throw new Error('Запись уже существует.');
  activeStore.set(k, value);
  return { pathname: k };
}
function appList_(prefix) {
  const p = String(prefix || '');
  const blobs = [];
  if (activeStore) for (const key of activeStore.keys()) if (key.startsWith(p)) blobs.push({ pathname: key });
  return { blobs, cursor: null };
}
function appDelete_(keys) {
  if (!activeStore) throw new Error('Хранилище не инициализировано.');
  const list = (Array.isArray(keys) ? keys : [keys]).map(String);
  let deleted = 0;
  for (const key of list) if (activeStore.delete(key)) deleted++;
  return { deleted };
}
function list(opts) { return appList_(opts && opts.prefix || ''); }
function del(keys) { return appDelete_(keys); }

async function loadStore() {
  if (!supabaseUrl || !serviceKey) throw new Error('Не заданы SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в переменных окружения.');
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('app_kv').select('key,value,updated_at').order('key').range(from, from + pageSize - 1);
    if (error) throw new Error('Не удалось прочитать app_kv: ' + error.message);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    if (from >= 99000) throw new Error('В хранилище слишком много строк для одной операции.');
  }
  return new Map(rows.map(row => [String(row.key), row.value]));
}

async function persistStore(before, after) {
  const changed = [];
  const removed = [];
  for (const [key, value] of after.entries()) {
    const previous = before.get(key);
    if (!before.has(key) || JSON.stringify(previous) !== JSON.stringify(value)) {
      changed.push({ key, value, updated_at: new Date().toISOString() });
    }
  }
  for (const key of before.keys()) if (!after.has(key)) removed.push(key);
  for (let i = 0; i < changed.length; i += 200) {
    const { error } = await supabase.from('app_kv').upsert(changed.slice(i, i + 200), { onConflict: 'key' });
    if (error) throw new Error('Не удалось сохранить данные: ' + error.message);
  }
  for (let i = 0; i < removed.length; i += 200) {
    const { error } = await supabase.from('app_kv').delete().in('key', removed.slice(i, i + 200));
    if (error) throw new Error('Не удалось удалить данные: ' + error.message);
  }
}

function parseRequestPath(request) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  return { url, query };
}

function buildResponse() {
  return {
    code: 200,
    setHeader() { return this; },
    status(n) { this.code = Number(n) || 200; return this; },
    json(value) { return { status: this.code, body: value }; }
  };
}

async function runApiUnlocked(route, request) {
  const { url, query } = parseRequestPath(request);
  let body = {};
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  }
  const store = await loadStore();
  const snapshot = new Map([...store.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  activeStore = store;
  let result;
  try {
    const req = {
      method: request.method.toUpperCase(), query, body,
      headers: Object.fromEntries(request.headers.entries())
    };
    const res = buildResponse();
    if (route === '/api/session') result = SESSION_HANDLER(req, res);
    else if (route === '/api/coach') result = COACH_HANDLER(req, res);
    else result = { status: 404, body: { ok: false, error: 'Маршрут не найден.' } };
    await persistStore(snapshot, store);
    return result;
  } finally {
    activeStore = null;
  }
}

export function runApi(route, request) {
  const job = requestQueue.then(() => runApiUnlocked(route, request));
  requestQueue = job.catch(() => {});
  return job;
}

const SESSION_HANDLER=(function(){

const TEAM_MIN = 1, TEAM_MAX = 4, ROLE_COUNT = 5;

const ROLE_CAPACITY = [20, 28, 24, 32, 16];



const TASK_HOURS = {

  1:18, 2:12, 3:20, 4:10, 5:28, 6:16, 7:12,

  8:16, 9:24, 10:12, 11:8, 12:6, 13:8, 14:10

};



const BASE_TASKS = {

  1:'Провести 10 интервью с мастерами и кладовщиками',

  2:'Описать текущий процесс «как есть»',

  3:'Проанализировать данные по 100 заявкам',

  4:'Определить 3 главных узких места',

  5:'Разработать новую электронную форму заявки',

  6:'Создать Kanban-доску заявок',

  7:'Разработать новые правила согласования',

  8:'Разработать стандарт комплектации заявки',

  9:'Подготовить пилот на одном участке',

  10:'Подготовить обучение сотрудников',

  11:'Определить KPI и способ измерения результата',

  12:'Подготовить промежуточный отчёт директору',

  13:'Проверить решение на соответствие требованиям ОТ',

  14:'Подготовить план масштабирования'

};



const ONGOING_WORK = [

  {id:'live-a', title:'Разобрать причины задержек на согласовании заявки', hours:12, baseId:null, spent:5, cost:2, source:'Работу начали до Scrum: искали, где заявки теряют время между этапами'},

  {id:'live-b', title:'Проверить передачу заявки между участком, снабжением и складом', hours:16, baseId:null, spent:7, cost:4, source:'Работу начали до Scrum: проверяли фактический маршрут заявки'},

  {id:'live-c', title:'Уточнить обязательные данные для запуска заявки в работу', hours:10, baseId:null, spent:4, cost:1, source:'Работу начали до Scrum: собирали проблемы с неполными заявками'}

];



const VARIANT_TWEAKS = [

  {3:0,5:0,6:0,9:0},

  {3:2,5:-2,6:2,9:-2},

  {3:-2,5:2,6:-2,9:2},

  {3:0,5:4,6:-2,9:0}

];



function normalizeCode(value){

  const raw=String(value||'').trim().toUpperCase();

  return raw || null;

}

function storageKey(code){

  // Keep arbitrary user-facing codes distinct enough for Blob paths.

  // Normalization is intentionally shared by coach and participant APIs.

  return encodeURIComponent(String(code)).slice(0,120);

}

function normalizeTeam(value){

  const n=Number(value);

  return Number.isInteger(n)&&n>=TEAM_MIN&&n<=TEAM_MAX?n:null;

}

function metaPath(code){return `sessions/${storageKey(code)}/meta.json`;}

function teamStatePath(code,team){return `sessions/${storageKey(code)}/teams/team-${team}.json`;}

function sharedPath(code,team){return `sessions/${storageKey(code)}/teams/team-${team}/shared.json`;}

function scrumTimerPath(code,team){return `sessions/${storageKey(code)}/teams/team-${team}/scrum-timer.json`;}



function exerciseTaskPrefix(code,team){return `sessions/${storageKey(code)}/teams/team-${team}/exercise1/tasks/`;}

function exerciseTaskPath(code,team,taskId){

  const safe=String(taskId).replace(/[^A-Za-z0-9.\_-]/gi,'\_').slice(0,100);

  return `${exerciseTaskPrefix(code,team)}${safe}.json`;

}

function exerciseLockPath(code,team){return `sessions/${storageKey(code)}/teams/team-${team}/exercise1/LOCK.json`;}



function readJson(pathname){return appRead_(pathname);}



function writeJson(pathname,obj,allowOverwrite=true){return appWrite_(pathname,obj,allowOverwrite);}



function listAll(prefix){return appList_(prefix).blobs;}



function deletePrefix(prefix){

  const blobs=listAll(prefix);

  for(let i=0;i<blobs.length;i+=100){

    const paths=blobs.slice(i,i+100).map(x=>x.pathname);

    if(paths.length)appDelete_(paths,{access:'private'});

  }

  return blobs.length;

}



function ensureSession(code){

  let meta=readJson(metaPath(code));

  if(!meta){

    meta={

      code,

      name:`Сессия ${code}`,

      teams:4,

      createdAt:new Date().toISOString(),

      status:'active',

      assignments:{'1':0,'2':1,'3':2,'4':3},



      autoCreated:true

    };

    try{writeJson(metaPath(code),meta,false);}catch(\_){/\* another request may have created it \*/}

    // Re-read so concurrent first entries converge on one session metadata object.

    const actual=readJson(metaPath(code));

    if(!actual)throw new Error('Не удалось создать сессию в базе данных.');

    return actual;

  }



  let changed=false;

  if(meta.roleOrders){delete meta.roleOrders;changed=true;}

  if(!meta.status){meta.status='active';changed=true;}

  if(!meta.assignments){

    meta.assignments={'1':0,'2':1,'3':2,'4':3};

    changed=true;

  }

  if(changed)writeJson(metaPath(code),meta,true);

  return meta;

}



function requireActiveSession(code){

  const meta=ensureSession(code);

  if(meta.status==='ended'){

    const err=new Error('Сессия завершена ведущим. Изменения больше не принимаются.');

    err.code='SESSION_ENDED';

    throw err;

  }

  return meta;

}



function exerciseTaskMap(tasks,variantIndex){

  const tweak=VARIANT_TWEAKS[variantIndex]||{};

  const map={};

  for(const item of tasks||[]){

    const id=Number(item.baseId),base=BASE_TASKS[id];

    if(!base)continue;

    map[String(item.id)]={

      id:item.id,

      baseId:id,

      title:base,

      hours:(TASK_HOURS[id]||8)+(tweak[id]||0)

    };

  }

  return map;

}



function seedKanbanFromBacklog(tasks,plan,variantIndex){

  const map=exerciseTaskMap(tasks,variantIndex);

  const selected=Object.values(map).filter(t=>(plan.selectedIds||[]).includes(t.id));

  const unselected=Object.values(map).filter(t=>!(plan.selectedIds||[]).includes(t.id));

  const todo=unselected.slice(0,2);



  return {

    backlog:selected.map(t=>({

      id:`backlog-${t.id}`,baseId:t.baseId,title:t.title,hoursSpent:0,hoursLeft:t.hours,cost:0,

      source:'Выбрана командой на Scrum Planning — ожидает движения в потоке'

    })),

    todo:todo.map(t=>({

      id:`todo-${t.id}`,baseId:t.baseId,title:t.title,hoursSpent:0,hoursLeft:t.hours,cost:0,

      source:'Задача из месячного backlog, но ещё не начата'

    })),

    doing:ONGOING_WORK.map((t)=>({

      id:t.id,baseId:t.baseId,title:t.title,hoursSpent:t.spent,hoursLeft:Math.max(1,t.hours-t.spent),

      cost:t.cost,source:t.source

    })),

    done:[]

  };

}



function readExerciseTasks(code,team){

  const blobs=listAll(exerciseTaskPrefix(code,team));

  const tasks=[];

  for(const b of blobs){

    if(b.pathname.endsWith('/LOCK.json'))continue;

    const task=readJson(b.pathname);

    if(task)tasks.push(task);

  }

  tasks.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));

  return tasks;

}



function readExercise1(code,team){

  const tasks=readExerciseTasks(code,team);

  const lock=readJson(exerciseLockPath(code,team));

  return {tasks,locked:!!lock,lockedAt:lock?.lockedAt||null};

}



function cleanAllocationValue(value){

  const n=Number(value);

  return Number.isFinite(n)&&n>=0?n:0;

}



function cleanScrumPlan(incoming,validTaskIds){

  const allowed=new Set(validTaskIds);

  const selected=[];

  for(const raw of (Array.isArray(incoming?.selectedIds)?incoming.selectedIds:[]).slice(0,10)){

    const id=String(raw);

    if(allowed.has(id)&&!selected.includes(id))selected.push(id);

  }



  const allocations={};

  const rawAlloc=incoming?.allocations&&typeof incoming.allocations==='object'?incoming.allocations:{};

  for(const id of selected){

    const src=rawAlloc[id]&&typeof rawAlloc[id]==='object'?rawAlloc[id]:{};

    const row={};

    for(let role=0;role<ROLE_COUNT;role++)row[role]=cleanAllocationValue(src[role]);

    allocations[id]=row;

  }



  return {selectedIds:selected,allocations,locked:false,updatedAt:new Date().toISOString()};

}



function validateScrumPlan(plan,map){

  if(!Array.isArray(plan.selectedIds)||!plan.selectedIds.length)return 'Выберите задачи для спринта.';

  if(plan.selectedIds.length>10)return 'В Sprint Backlog можно поставить максимум 10 задач.';



  for(const id of plan.selectedIds){

    const task=map[String(id)];

    if(!task)return 'В Sprint Backlog есть задача не из общего backlog.';

    const alloc=plan.allocations?.[id]||{};

    let allocated=0;

    for(let role=0;role<ROLE_COUNT;role++){

      const n=Number(alloc[role]||0);

      if(!Number.isFinite(n)||n<0)return `Некорректное распределение для «${task.title}».`;

      allocated+=n;

    }

    if(Math.abs(allocated-task.hours)>1e-9){

      return `«${task.title}» распределена на ${allocated} ч из ${task.hours} ч.`;

    }

  }



  for(let role=0;role<ROLE_CAPACITY.length;role++){

    const used=plan.selectedIds.reduce((sum,id)=>sum+Number(plan.allocations?.[id]?.[role]||0),0);

    if(used>ROLE_CAPACITY[role]+1e-9){

      return `Превышен лимит участника ${role+1}: ${used} из ${ROLE_CAPACITY[role]} ч.`;

    }

  }

  return null;

}



function boardShape(board){

  const source=board&&typeof board==='object'?board:{};

  return {

    backlog:Array.isArray(source.backlog)?source.backlog.filter(Boolean):[],

    todo:Array.isArray(source.todo)?source.todo.filter(Boolean):[],

    doing:Array.isArray(source.doing)?source.doing.filter(Boolean):[],

    done:Array.isArray(source.done)?source.done.filter(Boolean):[]

  };

}

function boardIdsUnique(board){

  const ids=[];

  for(const key of ['backlog','todo','doing','done'])for(const item of board[key])ids.push(String(item?.id||''));

  return ids.every(id=>id&&ids.filter(x=>x===id).length===1);

}

function validateKanbanUpdate(previous,incoming){

  const next=boardShape(incoming);

  if(!boardIdsUnique(next))return 'На доске есть дубли или задачи без ID.';

  if(next.todo.length>3 && next.todo.length>=previous.todo.length)return 'Лимит «Надо сделать» — максимум 3 задачи.';

  if(next.doing.length>2 && next.doing.length>=previous.doing.length)return 'Лимит «В работе» — максимум 2 задачи.';

  return null;

}



function handler(req,res){

  res.setHeader('Cache-Control','no-store');

  try{

    if(req.method==='GET'){

      const code=normalizeCode(req.query.code);

      const team=normalizeTeam(req.query.team);



      if(!code)return res.status(400).json({ok:false,error:'Введите любой непустой код сессии.'});

      if(!team)return res.status(400).json({ok:false,error:'Номер команды должен быть от 1 до 4.'});



      let meta=readJson(metaPath(code));

      const allowCreate=req.query.create==='1';

      if(!meta){

        if(!allowCreate)return res.status(404).json({ok:false,error:'Сессия не найдена.'});

        meta=ensureSession(code);

      }

      const teamLimit=Math.max(1,Math.min(4,Number(meta.teams)||4));

      if(team>teamLimit)return res.status(409).json({ok:false,error:`В этой сессии создано ${teamLimit} команд. Выберите номер команды от 1 до ${teamLimit}.`,code:'TEAM_NOT_CONFIGURED'});



      const state=readJson(teamStatePath(code,team));

      const exercise1=readExercise1(code,team);

      const shared=readJson(sharedPath(code,team));

      const scrumTimer=readJson(scrumTimerPath(code,team));

      const safeShared={...(shared||{scrumPlan:{selectedIds:[],allocations:{},locked:false,updatedAt:null},scrumStartedAt:null,kanban:null,kanbanUrgent:false}),scrumStartedAt:scrumTimer?.startedAt||shared?.scrumStartedAt||null};



      return res.status(200).json({

        ok:true,

        session:{code:meta.code,name:meta.name,teams:meta.teams,createdAt:meta.createdAt,status:meta.status||'active',endedAt:meta.endedAt||null},

        team:{teamNumber:team,variantIndex:meta.assignments[String(team)]??((team-1)%4)},

        state,

        exercise1,

        shared:safeShared

      });

    }



    if(req.method==='POST'){

      let body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};

      const allowed=['saveState','addExerciseTask','removeExerciseTask','lockExercise1','startScrumTimer','saveScrumPlan','lockScrum','saveKanban'];

      if(!allowed.includes(body.action))return res.status(400).json({ok:false,error:'Unknown action'});



      const code=normalizeCode(body.sessionCode);

      const team=normalizeTeam(body.teamNumber);

      if(!code)return res.status(400).json({ok:false,error:'Код сессии пустой.'});

      if(!team)return res.status(400).json({ok:false,error:'Номер команды должен быть от 1 до 4.'});



      let meta;

      try{meta=requireActiveSession(code)}catch(e){

        if(e.code==='SESSION_ENDED')return res.status(409).json({ok:false,error:e.message,code:e.code});

        throw e;

      }

      const teamLimit=Math.max(1,Math.min(4,Number(meta.teams)||4));

      if(team>teamLimit)return res.status(409).json({ok:false,error:`В этой сессии создано ${teamLimit} команд. Выберите номер команды от 1 до ${teamLimit}.`,code:'TEAM_NOT_CONFIGURED'});



      if(body.action==='startScrumTimer'){

        let timer=readJson(scrumTimerPath(code,team));

        if(!timer){

          const preferred=String(body.preferredStartedAt||'').trim();

          const startedAt=preferred && Number.isFinite(Date.parse(preferred)) ? new Date(Date.parse(preferred)).toISOString() : new Date().toISOString();

          const candidate={startedAt};

          try{writeJson(scrumTimerPath(code,team),candidate,false);}catch(\_){/\* another participant started it \*/}

          timer=readJson(scrumTimerPath(code,team));

          if(!timer)timer=candidate;

        }

        return res.status(200).json({ok:true,scrumStartedAt:timer.startedAt});

      }



      if(body.action==='saveState'){

        const variantIndex=meta.assignments[String(team)]??((team-1)%4);

        const incoming={...(body.state||{})};

        delete incoming.roleIndex;

        delete incoming.participantId;

        delete incoming.coachPassword;

        delete incoming.scrumTimer;

        delete incoming.scrumPoll;

        delete incoming.kanbanPoll;

        delete incoming.exercise1Poll;

        const state={

          ...incoming,

          sessionCode:code,

          teamNumber:team,

          variantIndex,

          serverSavedAt:new Date().toISOString()

        };

        writeJson(teamStatePath(code,team),state,true);

        return res.status(200).json({ok:true});

      }



      if(body.action==='addExerciseTask'){

        if(readJson(exerciseLockPath(code,team)))return res.status(409).json({ok:false,error:'Упражнение 1 уже зафиксировано.'});

        const existing=readExerciseTasks(code,team);

        if(existing.length>=10)return res.status(409).json({ok:false,error:'В общем backlog уже 10 задач — это максимум.'});

        const baseId=Number(body.task?.baseId);

        if(!Number.isInteger(baseId)||!BASE_TASKS[baseId])return res.status(400).json({ok:false,error:'Можно выбирать только задачи из предложенного списка.'});

        if(existing.some(x=>Number(x.baseId)===baseId))return res.status(200).json({ok:true,tasks:existing,already:true});

        const task={id:`base-${baseId}`,baseId,title:BASE_TASKS[baseId],hours:TASK_HOURS[baseId]||8,createdAt:new Date().toISOString()};

        writeJson(exerciseTaskPath(code,team,task.id),task,true);

        return res.status(200).json({ok:true,tasks:readExerciseTasks(code,team)});

      }



      if(body.action==='removeExerciseTask'){

        if(readJson(exerciseLockPath(code,team)))return res.status(409).json({ok:false,error:'Упражнение 1 уже зафиксировано.'});

        const id=String(body.taskId||'');

        if(!/^base-\d+$/.test(id))return res.status(400).json({ok:false,error:'Некорректный taskId.'});

        appDelete_(exerciseTaskPath(code,team,id),{access:'private'});

        return res.status(200).json({ok:true,tasks:readExerciseTasks(code,team)});

      }



      if(body.action==='lockExercise1'){

        const existingLock=readJson(exerciseLockPath(code,team));

        if(existingLock)return res.status(200).json({ok:true,locked:true,tasks:readExerciseTasks(code,team)});

        const tasks=readExerciseTasks(code,team);

        if(tasks.length<5)return res.status(400).json({ok:false,error:`Нужно минимум 5 задач. Сейчас: ${tasks.length}.`});

        if(tasks.length>10)return res.status(400).json({ok:false,error:`Максимум 10 задач. Сейчас: ${tasks.length}.`});

        writeJson(exerciseLockPath(code,team),{lockedAt:new Date().toISOString(),taskIds:tasks.map(x=>x.id),count:tasks.length},true);

        return res.status(200).json({ok:true,locked:true,tasks});

      }



      if(body.action==='saveScrumPlan'){

        const exercise=readExerciseTasks(code,team);

        const exerciseLock=readJson(exerciseLockPath(code,team));

        if(!exerciseLock)return res.status(409).json({ok:false,error:'Сначала зафиксируйте упражнение 1.'});

        const existing=readJson(sharedPath(code,team));

        const current=existing||{scrumPlan:{selectedIds:[],allocations:{},locked:false,updatedAt:null},scrumStartedAt:null,kanban:null,kanbanUrgent:false};

        if(current.scrumPlan?.locked)return res.status(409).json({ok:false,error:'Scrum-план уже зафиксирован.'});

        const clean=cleanScrumPlan(body.scrumPlan||{},exercise.map(x=>String(x.id)));

        writeJson(sharedPath(code,team),{...current,scrumStartedAt:current.scrumStartedAt||null,scrumPlan:clean},true);

        return res.status(200).json({ok:true,scrumPlan:clean});

      }



      if(body.action==='lockScrum'){

        const exercise=readExerciseTasks(code,team);

        const exerciseLock=readJson(exerciseLockPath(code,team));

        if(!exerciseLock)return res.status(409).json({ok:false,error:'Сначала зафиксируйте упражнение 1.'});

        const variant=meta.assignments[String(team)]??((team-1)%4);

        const map=exerciseTaskMap(exercise,variant);

        const incoming=cleanScrumPlan(body.scrumPlan||{},exercise.map(x=>String(x.id)));

        const validation=validateScrumPlan(incoming,map);

        if(validation)return res.status(400).json({ok:false,error:validation});



        const existing=readJson(sharedPath(code,team));

        const current=existing||{scrumPlan:{selectedIds:[],allocations:{},locked:false,updatedAt:null},scrumStartedAt:null,kanban:null,kanbanUrgent:false};

        if(current.scrumPlan?.locked)return res.status(409).json({ok:false,error:'Scrum-план уже зафиксирован.'});



        const scrumPlan={...incoming,locked:true,lockedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};

        const kanban=seedKanbanFromBacklog(exercise,scrumPlan,variant);

        writeJson(sharedPath(code,team),{...current,scrumStartedAt:current.scrumStartedAt||null,scrumPlan,kanban,kanbanUrgent:false},true);

        return res.status(200).json({ok:true,scrumPlan,kanban});

      }



      if(body.action==='saveKanban'){

        const existing=readJson(sharedPath(code,team));

        if(!existing?.scrumPlan?.locked)return res.status(409).json({ok:false,error:'Сначала зафиксируйте Scrum-план.'});

        const previous=boardShape(existing.kanban);

        const incoming=boardShape(body.kanban||previous);

        const validation=validateKanbanUpdate(previous,incoming);

        if(validation)return res.status(400).json({ok:false,error:validation});

        writeJson(sharedPath(code,team),{

          ...existing,

          kanban:incoming,

          kanbanUrgent:!!body.kanbanUrgent

        },true);

        return res.status(200).json({ok:true});

      }

    }



    res.setHeader('Allow','GET, POST');

    return res.status(405).json({ok:false,error:'Method Not Allowed'});

  }catch(e){

    console.error(e);

    return res.status(500).json({ok:false,error:'Ошибка сервера: '+String(e?.message||e)});

  }

}



return handler;

})();

const COACH_HANDLER=(function(){

const TASK_HOURS={1:18,2:12,3:20,4:10,5:28,6:16,7:12,8:16,9:24,10:12,11:8,12:6,13:8,14:10};

const TWEAKS=[

  {3:0,5:0,6:0,9:0},

  {3:2,5:-2,6:2,9:-2},

  {3:-2,5:2,6:-2,9:2},

  {3:0,5:4,6:-2,9:0}

];



function auth(req,body){return String(req.headers['x-coach-password']||body?.password||'')===String(process.env.COACH_PASSWORD||'');}

function norm(v){return String(v||'').trim().toUpperCase();}

function storageKey(code){return encodeURIComponent(String(code));}

function sessionPrefix(code){return `sessions/${storageKey(code)}/`;}

function metaPath(code){return `${sessionPrefix(code)}meta.json`;}

function teamStatePath(code,team){return `${sessionPrefix(code)}teams/team-${team}.json`;}

function sharedPath(code,team){return `${sessionPrefix(code)}teams/team-${team}/shared.json`;}

function exercisePrefix(code,team){return `${sessionPrefix(code)}teams/team-${team}/exercise1/tasks/`;}



function readJson(pathname){return appRead_(pathname);}

function writeJson(pathname,obj){return appWrite_(pathname,obj,true);}

function listAll(prefix){return appList_(prefix).blobs;}

function deletePrefix(prefix){

  const blobs=listAll(prefix);

  for(let i=0;i<blobs.length;i+=100){

    const paths=blobs.slice(i,i+100).map(x=>x.pathname);

    if(paths.length)appDelete_(paths,{access:'private'});

  }

  return blobs.length;

}

function readExerciseTasksForCoach(code,team){

  const out=[];

  for(const b of listAll(exercisePrefix(code,team))){

    const task=readJson(b.pathname);if(task)out.push(task);

  }

  return out.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));

}

function summarize(state,variant){

  const ids=state?.sprintSelected||[],tw=TWEAKS[variant]||{};

  const hours=ids.reduce((s,id)=>s+(TASK_HOURS[id]||0)+(tw[id]||0),0);

  return {phase:state?.phase||'ex1',sprintHours:hours,wip:state?.kanban?.doing?.length||0,done:state?.kanban?.done?.length||0,urgent:!!state?.kanbanUrgent,updatedAt:state?.serverSavedAt||state?.savedAt||null};

}

function makeCode(){

  const d=new Date();

  const dd=String(d.getDate()).padStart(2,'0'),mm=String(d.getMonth()+1).padStart(2,'0');

  return `SK-${dd}${mm}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

}



function handler(req,res){

  res.setHeader('Cache-Control','no-store');

  try{

    if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method Not Allowed'});



    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};

    const password=String(req.headers['x-coach-password']||body?.password||'');

    const expectedPassword=String(process.env.COACH_PASSWORD||'');

    if(!expectedPassword)return res.status(503).json({ok:false,error:'Не задан пароль ведущего. Добавьте секрет COACH_PASSWORD в переменные окружения приложения.'});



    if(body.action==='health'){

      if(password!==expectedPassword)return res.status(401).json({ok:false,error:'Пароль ведущего неверный.'});

      try{

        const result=list({prefix:'sessions/',limit:1});

        return res.status(200).json({ok:true,storage:'ok',message:'Связь с базой данных работает.',blobCount:Number(result?.blobs?.length||0)});

      }catch(error){

        console.error('Database health error',error);

        return res.status(500).json({ok:false,error:'База данных недоступна. Проверьте настройки базы данных TatNet Supabase.',detail:String(error?.message||error)});

      }

    }



    if(password!==String(process.env.COACH_PASSWORD||'')){

      return res.status(401).json({ok:false,error:'Пароль ведущего неверный. Проверьте переменную COACH_PASSWORD в настройках TatNet Apps.'});

    }



    if(body.action==='createSession'){

      const teams=Math.max(1,Math.min(4,Number(body.teams)||4));

      let code=makeCode();

      for(let i=0;i<5&&readJson(metaPath(code));i++)code=makeCode();

      const assignments={};

      const variants=[0,1,2,3].sort(()=>Math.random()-.5);

      for(let i=1;i<=teams;i++)assignments[String(i)]=variants[i-1];

      const meta={

        code,

        name:String(body.name||'Новая сессия').trim(),

        teams,

        createdAt:new Date().toISOString(),

        status:'active',

        assignments,

        autoCreated:false

      };

      try{writeJson(metaPath(code),meta)}

      catch(error){

        console.error('createSession Blob error',error);

        return res.status(500).json({ok:false,error:'Не удалось создать сессию: База данных недоступна. Проверьте настройки базы данных TatNet Supabase.',detail:String(error?.message||error)});

      }

      return res.status(200).json({ok:true,session:{code,name:meta.name,teams,createdAt:meta.createdAt,status:meta.status}});

    }



    if(body.action==='listSessions'){

      try{

        const metas=(listAll('sessions/')).filter(b=>/\/meta.json$/.test(b.pathname));

        const sessions=[];

        for(const b of metas){

          const meta=readJson(b.pathname);if(!meta)continue;

          let completed=0,totalTasks=0;

          for(let i=1;i<=meta.teams;i++){

            const st=readJson(teamStatePath(meta.code,i));

            if(st?.phase==='debrief')completed++;

            totalTasks+=(readExerciseTasksForCoach(meta.code,i)).length;

          }

          sessions.push({code:meta.code,name:meta.name,teams:meta.teams,createdAt:meta.createdAt,status:meta.status||'active',endedAt:meta.endedAt||null,completedTeams:completed,exerciseTaskCount:totalTasks});

        }

        sessions.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));

        return res.status(200).json({ok:true,sessions});

      }catch(error){

        console.error('listSessions Blob error',error);

        return res.status(500).json({ok:false,error:'Не удалось загрузить сессии: База данных недоступна. Проверьте настройки базы данных TatNet Supabase.',detail:String(error?.message||error)});

      }

    }



    if(body.action==='getSession'){

      const code=norm(body.code);

      if(!code)return res.status(400).json({ok:false,error:'Не указан код сессии.'});

      try{

        const meta=readJson(metaPath(code));

        if(!meta)return res.status(404).json({ok:false,error:'Сессия не найдена.'});

        const teams=[];

        for(let i=1;i<=meta.teams;i++){

          const st=readJson(teamStatePath(code,i));

          const exercise1=readExerciseTasksForCoach(code,i);

          teams.push({teamNumber:i,variantIndex:meta.assignments[String(i)],state:st,summary:summarize(st,meta.assignments[String(i)]),exercise1:{count:exercise1.length},shared:readJson(sharedPath(code,i))});

        }

        return res.status(200).json({ok:true,session:meta,teams});

      }catch(error){

        console.error('getSession Blob error',error);

        return res.status(500).json({ok:false,error:'Не удалось открыть сессию: База данных недоступна.',detail:String(error?.message||error)});

      }

    }



    if(body.action==='endSession'){

      const code=norm(body.code);

      const meta=readJson(metaPath(code));

      if(!meta)return res.status(404).json({ok:false,error:'Сессия не найдена.'});

      if(meta.status==='ended')return res.status(200).json({ok:true,status:'ended',endedAt:meta.endedAt||null});

      meta.status='ended';

      meta.endedAt=new Date().toISOString();

      writeJson(metaPath(code),meta);

      return res.status(200).json({ok:true,status:'ended',endedAt:meta.endedAt});

    }



    if(body.action==='deleteSession'){

      const code=norm(body.code);

      const meta=readJson(metaPath(code));

      if(!meta)return res.status(404).json({ok:false,error:'Сессия не найдена.'});

      const count=deletePrefix(sessionPrefix(code));

      return res.status(200).json({ok:true,deletedBlobs:count,code});

    }



    return res.status(400).json({ok:false,error:'Неизвестное действие.'});

  }catch(e){

    console.error('coach endpoint error',e);

    return res.status(500).json({ok:false,error:'Ошибка API: '+String(e?.message||e)});

  }

}



return handler;

})();
