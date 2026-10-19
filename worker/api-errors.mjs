export const unavailable='Сервер временно недоступен. Попробуйте обновить позже.';
export const safeError=error=>/<\s*!doctype|<\s*html|<\s*head|<\s*body|Unexpected token.*<|not valid JSON|JSON\.parse/i.test(String(error?.message||error))?unavailable:String(error?.message||error||unavailable).slice(0,240);
export async function checkedJson(response){
  const text=await response.text();let data;try{if(/^\s*</.test(text))throw Error();data=text?JSON.parse(text):{};}catch{throw new Error(unavailable);}
  if(!response.ok)throw new Error(safeError(data.message||data.error||`Сервер вернул ошибку ${response.status}`));return data;
}
