const assert = require('node:assert/strict');
const { createHandoff, claimHandoff, resolveHandoff } = require('../handoff/omega-handoff-persistence');

function fakeDb() {
  const rows = new Map();
  return { rows, async query(sql, params) {
    if (sql.startsWith('INSERT')) { const [id, conversation, context] = params; if ([...rows.values()].some(r => r.conversation_id === conversation && ['WAITING_HUMAN','HUMAN_ACTIVE'].includes(r.status))) { const e = new Error('unique'); e.code = '23505'; throw e; } const row={handoff_id:id,conversation_id:conversation,status:'WAITING_HUMAN',handoff_context:JSON.parse(context),claimed_by:null,claimed_at:null,resolution:null}; rows.set(id,row); return {rows:[row]}; }
    if (sql.startsWith('UPDATE') && sql.includes("SET status = 'HUMAN_ACTIVE'")) { const row=rows.get(params[0]); if(!row||row.status!=='WAITING_HUMAN')return {rows:[]}; row.status='HUMAN_ACTIVE'; row.claimed_by=params[1]; return {rows:[row]}; }
    if (sql.startsWith('UPDATE')) { const row=rows.get(params[0]); if(!row||row.status!=='HUMAN_ACTIVE')return {rows:[]}; row.status=params[1]; row.resolution=JSON.parse(params[2]); return {rows:[row]}; }
    throw new Error('unexpected SQL');
  } };
}

(async()=>{
  const db=fakeDb(); const context={handoff_id:'test-handoff',conversation_id:'test-conversation',schema_version:'omega-handoff-context-v1',excluded_data_domains:['NETROOM_PRIVATE']};
  const created=await createHandoff(db,context); assert.equal(created.status,'WAITING_HUMAN'); assert.deepEqual(created.handoff_context,context);
  const claimed=await claimHandoff(db,created.handoff_id,{id:'operator-test',role:'support'}); assert.equal(claimed.status,'HUMAN_ACTIVE');
  await assert.rejects(()=>claimHandoff(db,created.handoff_id,{id:'operator-second',role:'support'}),e=>e.code==='HANDOFF_NOT_CLAIMABLE');
  const resolution={handoff_id:created.handoff_id,resolved_by:'operator-test',operator_role:'support',resolution_summary:'test resolution',human_actions_taken:[],resolved_items:[],remaining_items:[],next_owner:'AI',ai_resume_context:{},created_at:new Date().toISOString()};
  const returned=await resolveHandoff(db,created.handoff_id,resolution); assert.equal(returned.status,'RETURNED_TO_AI'); assert.deepEqual(returned.handoff_context,context);
  await assert.rejects(()=>resolveHandoff(db,created.handoff_id,{...resolution,next_owner:'CLOSE'}),e=>e.code==='HANDOFF_NOT_RESOLVABLE');
  console.log('Gate 05 05.2B lifecycle unit: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
