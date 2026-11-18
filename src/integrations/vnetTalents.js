import {createHash,timingSafeEqual} from 'node:crypto';
// Dedicated server-to-server, read-only route. No general business/session permissions.
export function installVnetTalents(app,{db,token=()=>process.env.VNET_TALENTS_READ_TOKEN}={}){
  app.all('/integrations/vnet/v1/talents',async c=>{
    c.header('Cache-Control','no-store');
    const expected=token(),supplied=c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if(typeof expected!=='string'||expected.length<32)return c.json({error:'Talent feed is not configured'},503);
    if(!supplied||!timingSafeEqual(createHash('sha256').update(expected).digest(),createHash('sha256').update(supplied).digest()))return c.json({error:'Unauthorized'},401);
    if(c.req.method!=='GET')return c.json({error:'Read only'},405);
    try{
      const result=await db("SELECT student_id,character_name,youtube_channel_id,x_account_id,status FROM students WHERE status = $1 ORDER BY student_id LIMIT 5001",['アクティブ']);
      if(result.rows.length>5000)return c.json({error:'Too many active talents'},413);
      const talents=result.rows.filter(r=>r.status==='アクティブ').map(r=>({id:String(r.student_id),name:String(r.character_name||'').trim(),status:'アクティブ',youtubeId:r.youtube_channel_id||'',xId:r.x_account_id||''}));
      return c.json({version:1,fetchedAt:new Date().toISOString(),talents});
    }catch{return c.json({error:'Talent feed unavailable'},503);}
  });
}
