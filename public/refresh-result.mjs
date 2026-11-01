export async function refreshWithCalendar({sync,calendar}){
  if(!await sync())throw new Error('Не удалось обновить расписание из базы.');
  let calendarError=null;try{await calendar();}catch(error){calendarError=error;}
  // A Google failure may still have applied a partial batch. Read it safely.
  const latest=await sync();
  return {calendarError,latest};
}
