// Compare server revisions rather than downloading descriptions on every poll.
// No timestamp cursor: offline edits and clock skew cannot skip a record.
export async function readCompactSnapshot(client,{table,cached=[],fromRow=row=>row,metadata='id,version,updated_at',activeOnly=false,force=false,pageSize=500,maxRows=50000}){
  const inventory=[];let after='';
  for(;;){
    let query=client.from(table).select(metadata).order('id').limit(pageSize);
    if(activeOnly)query=query.eq('deleted',false).not('notes','like','[[invitation]]%');
    if(after)query=query.gt('id',after);
    const {data,error}=await query;if(error)throw error;if(!Array.isArray(data))throw new Error('Некорректный ответ списка данных');
    if(inventory.length+data.length>maxRows)throw new Error('Слишком много записей для синхронизации');
    inventory.push(...data);if(data.length<pageSize)break;
    const next=data.at(-1).id;if(!next||next<=after)throw new Error('Не удалось продолжить загрузку списка');after=next;
  }
  const stored=new Map(cached.map(row=>[row.id,row])),dirty=inventory.filter(row=>{
    const previous=stored.get(row.id);if(force||!previous||previous.pending)return true;
    return 'version' in row?Number(previous.version)!==Number(row.version)||(previous.updatedAt||previous.updated_at)!==row.updated_at:false;
  });
  const fresh=new Map();
  for(let offset=0;offset<dirty.length;offset+=50){
    let query=client.from(table).select('*').in('id',dirty.slice(offset,offset+50).map(row=>row.id));
    if(activeOnly)query=query.eq('deleted',false);
    const {data,error}=await query;if(error)throw error;if(!Array.isArray(data))throw new Error('Некорректный ответ изменений');
    for(const row of data)fresh.set(row.id,fromRow(row));
  }
  const dirtyIds=new Set(dirty.map(row=>row.id)),rows=inventory.map(row=>dirtyIds.has(row.id)?fresh.get(row.id):stored.get(row.id)).filter(Boolean);
  const ids=new Set(rows.map(row=>row.id));
  return {rows,changed:dirty.length>0||cached.some(row=>!ids.has(row.id)),downloaded:dirty.length};
}
