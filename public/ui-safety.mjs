export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function writeTransaction(database,stores,write){
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(stores,'readwrite');
    tx.oncomplete=resolve;
    tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Не удалось сохранить данные на устройстве'));
    try{write(tx);}catch(error){tx.abort();reject(error);}
  });
}
