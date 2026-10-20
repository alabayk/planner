export function calendarSyncDue(scheduledTime=Date.now()){
  return Math.floor(Number(scheduledTime)/60000)%5===0;
}
